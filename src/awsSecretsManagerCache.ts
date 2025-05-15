import { SecretsManagerClient, GetSecretValueCommand, GetSecretValueCommandOutput } from '@aws-sdk/client-secrets-manager';
import { z } from 'zod';
import { EventEmitter } from 'events';

const configSchema = z.object({
  region: z.string().optional().default('us-east-1'),
  secretMappings: z.record(z.string(), z.string()).refine((obj) => Object.keys(obj).length > 0, {
    message: 'At least one secret mapping is required',
  }),
  refreshInterval: z.number().positive().default(300000), // 5 minutes
  maxRetries: z.number().int().min(0).default(3),
  retryDelay: z.number().positive().default(1000), // 1 second
  disableEvents: z.boolean().optional().default(false),
}).strict();

type SecretValue = string | Buffer | Record<string, unknown>;

interface CacheEntry {
  value: SecretValue;
  fetchedAt: number;
}

type AWSSecretsConfig = z.infer<typeof configSchema>;

class AWSSecretsManagerCache extends EventEmitter {
  private client: SecretsManagerClient;
  private cache: Map<string, CacheEntry>;
  private refreshIntervalId?: NodeJS.Timeout;
  private isRunning: boolean;
  private config: AWSSecretsConfig;

  constructor(config: AWSSecretsConfig) {
    super();
    this.config = configSchema.parse(config);
    this.client = new SecretsManagerClient({ region: this.config.region });
    this.cache = new Map();
    this.isRunning = false;
  }

  public async initialize(): Promise<void> {
    await this.fetchAllSecrets();
    this.startScheduledRefresh();
  }

  private async fetchAllSecrets(): Promise<void> {
    console.log('Fetching all secrets at', new Date().toISOString());
    const promises = Object.entries(this.config.secretMappings).map(([userId, secretId]) =>
      this.fetchSecretWithRetry(userId, secretId)
    );
    await Promise.all(promises);
    console.log('Finished fetching all secrets at', new Date().toISOString());
  }

  private async fetchSecretWithRetry(userId: string, secretId: string, attempt = 1): Promise<void> {
    try {
      const command = new GetSecretValueCommand({ SecretId: secretId });
      const response: GetSecretValueCommandOutput = await this.client.send(command);
      if (!response) {
        throw new Error(`No response received for secret ${secretId}`);
      }
      const secretValue: SecretValue = response.SecretString
        ? JSON.parse(response.SecretString)
        : response.SecretBinary
        ? Buffer.from(response.SecretBinary).toString('utf-8')
        : '';
      const currentEntry = this.cache.get(userId);
      const newEntry: CacheEntry = { value: secretValue, fetchedAt: Date.now() };

      if (!currentEntry || JSON.stringify(currentEntry.value) !== JSON.stringify(secretValue)) {
        this.cache.set(userId, newEntry);
        if (!this.config.disableEvents) {
          this.emit('update', { userId, value: secretValue, timestamp: newEntry.fetchedAt });
        }
        console.log(`Updated cache for ${userId} at ${new Date().toISOString()}`);
      }
    } catch (error) {
      if (attempt <= this.config.maxRetries) {
        const delay = this.config.retryDelay * Math.pow(2, attempt - 1);
        console.warn(`Retry ${attempt}/${this.config.maxRetries} for ${userId} after ${delay}ms:`, error);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.fetchSecretWithRetry(userId, secretId, attempt + 1);
      }
      if (!this.config.disableEvents) {
        this.emit('error', { userId, error, timestamp: Date.now() });
      }
      console.error(`Failed to fetch ${userId} after ${this.config.maxRetries} retries:`, error);
    }
  }

  private startScheduledRefresh(): void {
    if (!this.isRunning) {
      this.isRunning = true;
      this.refreshIntervalId = setInterval(() => {
        console.log('Scheduled refresh triggered at', new Date().toISOString());
        this.fetchAllSecrets().catch((error) => {
          if (!this.config.disableEvents) {
            this.emit('error', { error, timestamp: Date.now() });
          }
          console.error(`Scheduled refresh failed at ${new Date().toISOString()}:`, error);
        });
      }, this.config.refreshInterval);
      if (!this.config.disableEvents) {
        this.emit('start', { timestamp: Date.now() });
      }
      console.log(`Scheduled refresh started at ${new Date().toISOString()} with interval ${this.config.refreshInterval}ms`);
    }
  }

  public stopScheduledRefresh(): void {
    if (this.isRunning && this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
      this.isRunning = false;
      if (!this.config.disableEvents) {
        this.emit('stop', { timestamp: Date.now() });
      }
      console.log(`Scheduled refresh stopped at ${new Date().toISOString()}`);
    }
  }

  public getSecret(userId: string): SecretValue | undefined {
    const entry = this.cache.get(userId);
    return entry?.value;
  }

  public getAllSecrets(): Record<string, SecretValue> {
    const secrets: Record<string, SecretValue> = {};
    for (const [userId, entry] of this.cache) {
      secrets[userId] = entry.value;
    }
    return secrets;
  }

  public async addSecretMapping(userId: string, secretId: string): Promise<void> {
    this.config.secretMappings[userId] = secretId;
    await this.fetchSecretWithRetry(userId, secretId);
  }

  public removeSecretMapping(userId: string): void {
    delete this.config.secretMappings[userId];
    this.cache.delete(userId);
    if (!this.config.disableEvents) {
      this.emit('remove', { userId, timestamp: Date.now() });
    }
  }

  public clearCache(): void {
    this.cache.clear();
    if (this.isRunning) {
      this.stopScheduledRefresh();
    }
    if (!this.config.disableEvents) {
      this.emit('clear', { timestamp: Date.now() });
    }
  }

  public getCacheStats(): { size: number } {
    return { size: this.cache.size };
  }
}

export default AWSSecretsManagerCache;