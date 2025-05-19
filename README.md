# aws-secrets-cache

A JavaScript/TypeScript library for caching and refreshing AWS Secrets Manager secrets with user-friendly IDs, featuring scheduled refreshes and optional event emissions.

## Installation

`npm install aws-secrets-cache`

## Usage (Example)

```typescript
import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import AWSSecretsManagerCache from 'aws-secrets-cache';
import type { AWSSecretsConfig, UpdateEvent } from 'aws-secrets-cache';

const app = express();
const port = 3000;

const secretsConfig: AWSSecretsConfig = {
  secretMappings: { dbCredentials: 'arn:aws:secretsmanager:us-west-2:123456789012:secret:prod/postgres-credentials-xyz' },
  region: 'us-west-2',
  refreshInterval: 3600000, // 1 hour
};

const secretsManager = new AWSSecretsManagerCache(secretsConfig);
let pgPool: Pool | undefined;

interface DbCredentials {
  username: string;
  password: string;
  host: string;
  dbname: string;
  port: number;
}

async function initDbConnection() {
  try {
    const dbCredentials = secretsManager.getSecret('dbCredentials') as DbCredentials | undefined;
    if (!dbCredentials) throw new Error('No DB credentials');

    if (pgPool) await pgPool.end();

    pgPool = new Pool({
      user: dbCredentials.username,
      host: dbCredentials.host,
      database: dbCredentials.dbname,
      password: dbCredentials.password,
      port: dbCredentials.port,
    });

    const client = await pgPool.connect();
    console.log('DB connected');
    client.release();
  } catch (error) {
    console.error('DB init failed:', error);
  }
}

secretsManager.on('update', async (event: UpdateEvent) => {
  if (event.userId === 'dbCredentials') {
    await initDbConnection();
  }
});

secretsManager.on('error', (data: { userId: string; error: Error }) => console.error('Secrets error:', data.error));

app.get('/users', async (_req: Request, res: Response) => {
  try {
    if (!pgPool) throw new Error('Database not initialized');
    const result = await pgPool.query('SELECT * FROM users LIMIT 10');
    res.json(result.rows);
  } catch (error) {
    console.error('Query failed:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

(async () => {
  await secretsManager.initialize();
  await initDbConnection();
  app.listen(port, () => console.log(`Server on port ${port}`));
})();
```

<details>
  <summary>Advanced</summary>

```typescript
import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import AWSSecretsManagerCache from 'aws-secrets-cache';
import type { AWSSecretsConfig, Logger, UpdateEvent } from 'aws-secrets-cache';
import winston from 'winston';

const app = express();
const port = 3000;

// Optional: Create a Winston logger instance
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [new winston.transports.Console()],
}) satisfies Logger;

// Optional: custom AWS SecretsManagerClient with specific region
const customClient = new SecretsManagerClient({ region: 'us-west-2' });

const secretsConfig: AWSSecretsConfig = {
  secretMappings: { dbCredentials: 'arn:aws:secretsmanager:us-west-2:123456789012:secret:prod/postgres-credentials-xyz' },
  region: 'us-west-2',
  refreshInterval: 3600000,
  logger: logger,  
  client: customClient,
};

const secretsManager = new AWSSecretsManagerCache(secretsConfig);

let pgPool: Pool | undefined;

interface DbCredentials {
  username: string;
  password: string;
  host: string;
  dbname: string;
  port: number;
}

async function initDbConnection() {
  try {
    const dbCredentials = secretsManager.getSecret('dbCredentials') as DbCredentials | undefined;
    if (!dbCredentials) throw new Error('No DB credentials');

    if (pgPool) await pgPool.end();

    pgPool = new Pool({
      user: dbCredentials.username,
      host: dbCredentials.host,
      database: dbCredentials.dbname,
      password: dbCredentials.password,
      port: dbCredentials.port,
    });

    const client = await pgPool.connect();
    logger.info('DB connected');
    client.release();
  } catch (error) {
    logger.error('DB init failed:', error);
  }
}

secretsManager.on('update', async (event: UpdateEvent) => {
  if (event.userId === 'dbCredentials') {
    await initDbConnection();
  }
});

secretsManager.on('error', (data: { userId: string; error: Error }) => {
  logger.error(`Secrets error for ${data.userId}: ${data.error.message}`);
});

app.get('/users', async (_req: Request, res: Response) => {
  try {
    if (!pgPool) throw new Error('Database not initialized');
    const result = await pgPool.query('SELECT * FROM users LIMIT 10');
    res.json(result.rows);
  } catch (error) {
    logger.error('Query failed:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

(async () => {
  await secretsManager.initialize();
  await initDbConnection();
  app.listen(port, () => logger.info(`Server on port ${port}`));
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