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

## API Documentation

* `constructor(config: AWSSecretsConfig)`: Initializes the cache with configuration.
* `initialize()`: Promise<void>: Fetches initial secrets and starts scheduled refresh.
* `getSecret(userId: string)`: SecretValue | undefined: Retrieves a secret by ID.
* `getAllSecrets(): Record<string, SecretValue>`: Retrieves all secrets.
* `stopScheduledRefresh(): void`: Stops the scheduled refresh.
* `addSecretMapping(userId: string, secretId: string)`: Promise<void>: Adds a new secret mapping.
* `removeSecretMapping(userId: string): void`: Removes a secret mapping.
* `clearCache()`: void: Clears the cache and stops refresh.
* `getCacheStats()`: { size: number }: Returns cache size.

## Configuration Options

* `secretMappings`: Record of user-friendly IDs to AWS Secrets Manager IDs.
* `region`: AWS region (default: 'us-east-1').
* `refreshInterval`: Refresh interval in milliseconds (default: 300000).
* `maxRetries`: Number of retries for failed fetches (default: 3).
* `retryDelay`: Initial retry delay in milliseconds (default: 1000).

## Events

* `update`: Emitted when a secret is updated ({ userId, value, timestamp }).
* `error`: Emitted on fetch errors ({ userId, error, timestamp }).
* `start`: Emitted when refresh starts ({ timestamp }).
* `stop`: Emitted when refresh stops ({ timestamp }).

## License

MIT