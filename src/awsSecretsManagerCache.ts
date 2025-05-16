import {
  SecretsManagerClient,
  GetSecretValueCommand,
  GetSecretValueCommandOutput,
} from '@aws-sdk/client-secrets-manager';
import { z } from 'zod';
import { EventEmitter } from 'events';

interface Logger {
  debug?: (...args: any[]) => void;
  info?: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
}

const configSchema = z
  .object({
    region: z.string().optional().default('us-east-1'),
    secretMappings: z
      .record(z.string(), z.string())
      .refine((obj) => Object.keys(obj).length > 0, {
        message: 'At least one secret mapping is required',
      }),
    refreshInterval: z.number().positive().default(300000),
    maxRetries: z.number().int().min(0).default(3),
    retryDelay: z.number().positive().default(1000),
    disableEvents: z.boolean().optional().default(false),
    logger: z.union([z.boolean(), z.any()]).optional().default(true),
    client: z.instanceof(SecretsManagerClient).optional(),    
  })
  .strict();

type SecretValue = string | Buffer | Record<string, unknown>;

interface CacheEntry {
  value: SecretValue;
  fetchedAt: number;
}

type AWSSecretsConfig = z.infer<typeof configSchema> & {
  logger?: Logger | boolean;
  client?: SecretsManagerClient;
};

// Event types
export interface UpdateEvent {
  userId: string;
  value: SecretValue;
  timestamp: number;
}
export interface ErrorEvent {
  userId?: string;
  error: unknown;
  timestamp: number;
}
export interface StartStopEvent {
  timestamp: number;
}
export interface RemoveEvent {
  userId: string;
  timestamp: number;
}
export interface ClearEvent {
  timestamp: number;
}

class AWSSecretsManagerCache extends EventEmitter {
  private client: SecretsManagerClient;
  private cache: Map<string, CacheEntry>;
  private refreshIntervalId?: NodeJS.Timeout;
  private isRunning: boolean;
  private config: AWSSecretsConfig;
  private logger: Logger;

  constructor(config: AWSSecretsConfig) {
    super();
    this.config = configSchema.parse(config);
    this.client = config.client ?? new SecretsManagerClient({ region: this.config.region });
    this.cache = new Map();
    this.isRunning = false;

    const defaultLogger: Logger = {
      debug: () => {},
      info: console.log,
      warn: console.warn,
      error: console.error,
    };

    this.logger =
      this.config.logger === false ? {} : { ...defaultLogger, ...(this.config.logger || {}) };
  }

  public async initialize(): Promise<void> {
    await this.fetchAllSecrets();
    this.startScheduledRefresh();
  }

  private async fetchAllSecrets(): Promise<void> {
    this.logger.debug?.('Fetching all secrets at', new Date().toISOString());
    const promises = Object.entries(this.config.secretMappings).map(([userId, secretId]) =>
      this.fetchSecretWithRetry(userId, secretId)
    );
    await Promise.all(promises);
    this.logger.debug?.('Finished fetching all secrets at', new Date().toISOString());
  }

  private async fetchSecretWithRetry(
    userId: string,
    secretId: string,
    attempt = 1
  ): Promise<void> {
    try {
      const command = new GetSecretValueCommand({ SecretId: secretId });
      const response: GetSecretValueCommandOutput = await this.client.send(command);
      if (!response) throw new Error(`No response received for secret ${secretId}`);

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
          this.emit('update', { userId, value: secretValue, timestamp: newEntry.fetchedAt } satisfies UpdateEvent);
        }
        this.logger.info?.(`Updated cache for ${userId} at ${new Date().toISOString()}`);
      }
    } catch (error) {
      if (attempt <= this.config.maxRetries) {
        const delay = this.config.retryDelay * Math.pow(2, attempt - 1);
        this.logger.warn?.(
          `Retry ${attempt}/${this.config.maxRetries} for ${userId} after ${delay}ms:`,
          error
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.fetchSecretWithRetry(userId, secretId, attempt + 1);
      }
      if (!this.config.disableEvents) {
        this.emit('error', { userId, error, timestamp: Date.now() } satisfies ErrorEvent);
      }
      this.logger.error?.(
        `Failed to fetch ${userId} after ${this.config.maxRetries} retries:`,
        error
      );
    }
  }

  private startScheduledRefresh(): void {
    if (!this.isRunning) {
      this.isRunning = true;
      this.refreshIntervalId = setInterval(() => {
        this.logger.debug?.('Scheduled refresh triggered at', new Date().toISOString());
        this.fetchAllSecrets().catch((error) => {
          if (!this.config.disableEvents) {
            this.emit('error', { error, timestamp: Date.now() } satisfies ErrorEvent);
          }
          this.logger.error?.(`Scheduled refresh failed at ${new Date().toISOString()}:`, error);
        });
      }, this.config.refreshInterval);
      if (!this.config.disableEvents) {
        this.emit('start', { timestamp: Date.now() } satisfies StartStopEvent);
      }
      this.logger.info?.(
        `Scheduled refresh started at ${new Date().toISOString()} with interval ${this.config.refreshInterval}ms`
      );
    }
  }

  public stopScheduledRefresh(): void {
    if (this.isRunning && this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
      this.isRunning = false;
      if (!this.config.disableEvents) {
        this.emit('stop', { timestamp: Date.now() } satisfies StartStopEvent);
      }
      this.logger.info?.(`Scheduled refresh stopped at ${new Date().toISOString()}`);
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
      this.emit('remove', { userId, timestamp: Date.now() } satisfies RemoveEvent);
    }
  }

  public clearCache(): void {
    this.cache.clear();
    if (this.isRunning) {
      this.stopScheduledRefresh();
    }
    if (!this.config.disableEvents) {
      this.emit('clear', { timestamp: Date.now() } satisfies ClearEvent);
    }
  }

  public dispose(): void {
    this.clearCache();
  }

  public getCacheStats(): { size: number } {
    return { size: this.cache.size };
  }
}

export default AWSSecretsManagerCache;
export type {
  AWSSecretsConfig,
  Logger,
  SecretValue,
  CacheEntry
};
