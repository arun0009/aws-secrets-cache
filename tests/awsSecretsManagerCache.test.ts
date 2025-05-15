import AWSSecretsManagerCache from '../src/awsSecretsManagerCache';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

jest.mock('@aws-sdk/client-secrets-manager');

const mockSend = jest.fn();

beforeEach(() => {
    jest.useFakeTimers(); 
    jest.spyOn(global, 'setInterval');
    jest.spyOn(global, 'clearInterval');
    (SecretsManagerClient as jest.Mock).mockImplementation(() => ({
      send: mockSend,
    }));
  });

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe('AWSSecretsManagerCache', () => {
  let cache: AWSSecretsManagerCache;

  beforeEach(() => {
    cache = new AWSSecretsManagerCache({
      secretMappings: { testSecret: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test' },
      region: 'us-east-1',
      refreshInterval: 1000,
      maxRetries: 3,
      retryDelay: 100,
      disableEvents: false,
    });
  });

  afterEach(() => {
    cache.stopScheduledRefresh();
  });

  test('initializes and caches secret', async () => {
    mockSend.mockResolvedValueOnce({ SecretString: JSON.stringify({ key: 'value' }) });

    await cache.initialize();
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(cache.getSecret('testSecret')).toEqual({ key: 'value' });
  });

  test('emits update event on secret change', async () => {
    const listener = jest.fn();

    mockSend
      .mockResolvedValueOnce({ SecretString: JSON.stringify({ key: 'value' }) }) // First init
      .mockResolvedValueOnce({ SecretString: JSON.stringify({ key: 'newValue' }) }); // Refresh

    cache.on('update', listener);

    await cache.initialize();
    expect(listener).toHaveBeenCalledTimes(1); // Initial call

    // Trigger scheduled refresh
    jest.advanceTimersByTime(1000);
    await Promise.resolve(); // Allow event loop
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: 'testSecret', value: { key: 'newValue' } })
    );
  });

  test('stops scheduled refresh', async () => {
    mockSend.mockResolvedValueOnce({ SecretString: JSON.stringify({ key: 'value' }) });

    await cache.initialize();
    cache.stopScheduledRefresh();

    expect(cache['isRunning']).toBe(false);
    expect(clearInterval).toHaveBeenCalled();
  });

  test('adds and removes secret mapping', async () => {
    mockSend.mockResolvedValue({ SecretString: JSON.stringify({ key: 'value' }) });

    await cache.addSecretMapping('newSecret', 'arn:aws:secretsmanager:us-east-1:123456789012:secret:new');
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(cache.getSecret('newSecret')).toEqual({ key: 'value' });

    cache.removeSecretMapping('newSecret');
    expect(cache.getSecret('newSecret')).toBeUndefined();
  });
  
  test('handles binary secrets', async () => {
    const secretObj = { key: 'binaryValue' };
    const encodedBinary = Buffer.from(JSON.stringify(secretObj)).toString('base64');
    mockSend.mockResolvedValueOnce({ SecretBinary: encodedBinary });
  
    await cache.initialize();
    expect(cache.getSecret('testSecret')).toEqual(encodedBinary);
  });

  test('does not emit events when disabled', async () => {
    cache = new AWSSecretsManagerCache({
        secretMappings: { testSecret: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test' },
        region: 'us-east-1',
        refreshInterval: 1000,
        maxRetries: 3,
        retryDelay: 100,
        disableEvents: true,
    });
  
    const updateListener = jest.fn();
    cache.on('update', updateListener);
  
    mockSend.mockResolvedValueOnce({ SecretString: JSON.stringify({ key: 'value' }) });
  
    await cache.initialize();
    expect(updateListener).not.toHaveBeenCalled();
  });

  test('clears cache and stops refresh', async () => {
    mockSend.mockResolvedValueOnce({ SecretString: JSON.stringify({ key: 'value' }) });
  
    await cache.initialize();
    cache.clearCache();
  
    expect(cache.getSecret('testSecret')).toBeUndefined();
    expect(cache['isRunning']).toBe(false);
  });

});
