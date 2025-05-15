# aws-secrets-cache

A TypeScript library for caching and refreshing AWS Secrets Manager secrets with user-friendly IDs.

## Installation

`npm install aws-secrets-cache`

## Usage

```typescript
import AWSSecretsManagerCache from 'aws-secrets-cache';

const config = {
  secretMappings: {
    dbPassword: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:db-password-xyz',
    apiKey: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:api-key-abc',
  },
  region: 'us-east-1',
  refreshInterval: 60000, // 1 minute
};

const secretsManager = new AWSSecretsManagerCache(config);

secretsManager.on('update', (data) => console.log(`Secret updated: ${data.userId} at ${new Date(data.timestamp).toISOString()}`));
secretsManager.on('error', (data) => console.error(`Error for ${data.userId}:`, data.error));

(async () => {
  await secretsManager.initialize();
  console.log('DB Password:', secretsManager.getSecret('dbPassword'));
  console.log('All secrets:', secretsManager.getAllSecrets());
})();
```

<details>
  <summary>Advanced</summary>

```typescript
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import AWSSecretsManagerCache from 'aws-secrets-cache';
import winston from 'winston';

// Optional: Create a Winston logger instance
const customLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [new winston.transports.Console()],
});

// Optional: custom AWS SecretsManagerClient with specific region
const customClient = new SecretsManagerClient({ region: 'us-west-2' });

const config = {
  secretMappings: {
    dbPassword: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:db-password-xyz',
    apiKey: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:api-key-abc',
  },
  refreshInterval: 60000, // 1 minute
  logger: customLogger,  // optional Winston logger (defaults to console)
  client: customClient,  // optional AWS SecretsManagerClient instance
};

const secretsManager = new AWSSecretsManagerCache(config);

secretsManager.on('update', (data) =>
  customLogger.info(`Secret updated: ${data.userId} at ${new Date(data.timestamp).toISOString()}`)
);

secretsManager.on('error', (data) =>
  customLogger.error(`Error for ${data.userId}:`, data.error)
);

(async () => {
  await secretsManager.initialize();
  customLogger.info('DB Password:', secretsManager.getSecret('dbPassword'));
  customLogger.info('All secrets:', secretsManager.getAllSecrets());
})();
```
</details>

## API Documentation

* `constructor(config: AWSSecretsConfig)`: Initializes the cache with configuration.
* `initialize()`: Promise<void>: Fetches initial secrets and starts scheduled refresh.
* `getSecret(userId: string)`: SecretValue | undefined: Retrieves a secret by ID.
* `getAllSecrets(): Record<string, SecretValue>`: Retrieves all secrets.
* `stopScheduledRefresh(): void`: Stops the scheduled refresh.
* `addSecretMapping(userId: string, secretId: string)`: Promise<void>: Adds a new secret mapping to the local cache. Note: This does not create or modify secrets in AWS Secrets Manager.
* `removeSecretMapping(userId: string): void`: Removes a secret mapping from the local cache. Note: This does not delete secrets from AWS Secrets Manager.
* `clearCache()`: void: Clears the cache and stops refresh.
* `getCacheStats()`: { size: number }: Returns cache size.

## Configuration Options

* `secretMappings`: Record of user-friendly IDs to AWS Secrets Manager IDs.
* `region`: AWS region (default: 'us-east-1').
* `refreshInterval`: Refresh interval in milliseconds (default: 300000).
* `maxRetries`: Number of retries for failed fetches (default: 3).
* `retryDelay`: Initial retry delay in milliseconds (default: 1000).
* `logger`: Optional logger (default: console). Provide an object with info, warn, and error methods (e.g. pino, winston), or pass false to disable all logs.
* `disableEvents`: Set to true to disable event emissions like update, error, start, stop, etc. (default: false).
* `client`: Optional custom SecretsManagerClient instance.


## Events

* `update`: Emitted when a secret is updated ({ userId, value, timestamp }).
* `error`: Emitted on fetch errors ({ userId, error, timestamp }).
* `start`: Emitted when refresh starts ({ timestamp }).
* `stop`: Emitted when refresh stops ({ timestamp }).

## License

MIT