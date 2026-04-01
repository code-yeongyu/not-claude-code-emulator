import { afterEach, describe, expect, it } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AuthenticationError,
  BASE_X_HEADERS,
  REQUIRED_BETAS,
  RateLimitError,
  buildAnthropicHeaders,
  parseOAuthToken,
  resolveOAuthToken,
  validateOAuthToken,
  verifyOAuthToken,
} from './oauth-client.js';
import { saveStoredTokens } from './token-store.js';

const originalHome = process.env.HOME;
const sandboxRoot = join(process.cwd(), '.tmp-oauth-client-test');

describe('validateOAuthToken', () => {
  it('should validate correct OAuth token format', () => {
    const validToken = 'sk-ant-oat01-PLACEHOLDER_TOKEN_USE_ENV_VAR';
    expect(validateOAuthToken(validToken)).toBe(true);
  });

  it('should reject invalid token format', () => {
    expect(validateOAuthToken('invalid-token')).toBe(false);
    expect(validateOAuthToken('sk-ant-api03-abc123')).toBe(false);
    expect(validateOAuthToken('')).toBe(false);
  });

  it('should reject non-string inputs', () => {
    expect(validateOAuthToken(null as unknown as string)).toBe(false);
    expect(validateOAuthToken(undefined as unknown as string)).toBe(false);
    expect(validateOAuthToken(123 as unknown as string)).toBe(false);
  });

  it('should trim whitespace before validation', () => {
    const token = 'sk-ant-oat01-PLACEHOLDER_TOKEN_USE_ENV_VAR';
    expect(validateOAuthToken(`  ${token}  `)).toBe(true);
  });
});

describe('parseOAuthToken', () => {
  it('should parse token from x-api-key header', () => {
    const token = 'sk-ant-oat01-test123';
    const headers = { 'x-api-key': token };
    expect(parseOAuthToken(headers)).toBe(token);
  });

  it('should parse token from Authorization Bearer header', () => {
    const token = 'sk-ant-oat01-test123';
    const headers = { authorization: `Bearer ${token}` };
    expect(parseOAuthToken(headers)).toBe(token);
  });

  it('should prefer x-api-key over Authorization', () => {
    const apiKey = 'sk-ant-oat01-from-api-key';
    const authToken = 'sk-ant-oat01-from-auth';
    const headers = {
      'x-api-key': apiKey,
      authorization: `Bearer ${authToken}`,
    };
    expect(parseOAuthToken(headers)).toBe(apiKey);
  });

  it('should trim whitespace from parsed token', () => {
    const token = 'sk-ant-oat01-test123';
    const headers = { 'x-api-key': `  ${token}  ` };
    expect(parseOAuthToken(headers)).toBe(token);
  });

  it('should throw AuthenticationError for missing headers', () => {
    expect(() => parseOAuthToken({})).toThrow(AuthenticationError);
    expect(() => parseOAuthToken({})).toThrow(
      'Missing or invalid Authorization or x-api-key header'
    );
  });

  it('should throw AuthenticationError for empty headers', () => {
    expect(() => parseOAuthToken({ 'x-api-key': '' })).toThrow(AuthenticationError);
    expect(() => parseOAuthToken({ 'x-api-key': '   ' })).toThrow(AuthenticationError);
  });

  it('should throw AuthenticationError for invalid Authorization format', () => {
    const headers = { authorization: 'Basic dXNlcjpwYXNz' };
    expect(() => parseOAuthToken(headers)).toThrow(AuthenticationError);
  });
});

describe('resolveOAuthToken', () => {
  it('given an x-api-key header when resolving then it returns the header token', async () => {
    const token = await resolveOAuthToken({ 'x-api-key': 'sk-ant-oat01-header-token' });

    expect(token).toBe('sk-ant-oat01-header-token');
  });

  it('given stored oauth tokens when no header exists then it returns the stored token', async () => {
    process.env.HOME = sandboxRoot;
    await saveStoredTokens({
      accessToken: 'sk-ant-oat01-stored-token',
      refreshToken: null,
      expiresAt: null,
      scopes: ['user:inference'],
    });

    const token = await resolveOAuthToken();

    expect(token).toBe('sk-ant-oat01-stored-token');
  });

  it('given no header and no stored token when resolving then it throws an authentication error', async () => {
    process.env.HOME = sandboxRoot;
    await rm(sandboxRoot, { recursive: true, force: true });

    await expect(resolveOAuthToken()).rejects.toThrow(AuthenticationError);
  });

  it('given missing headers and disabled fallback when resolving then it throws an authentication error', async () => {
    await expect(resolveOAuthToken({}, { allowStoredTokenFallback: false })).rejects.toThrow(
      AuthenticationError
    );
  });

  it('given an invalid auth header and a stored token when resolving then it rejects instead of falling back', async () => {
    process.env.HOME = sandboxRoot;
    await saveStoredTokens({
      accessToken: 'sk-ant-oat01-stored-token',
      refreshToken: null,
      expiresAt: null,
      scopes: ['user:inference'],
    });

    await expect(resolveOAuthToken({ authorization: 'Basic abc' })).rejects.toThrow(
      AuthenticationError
    );
  });
});

describe('buildAnthropicHeaders', () => {
  const token = 'sk-ant-oat01-test123';

  it('should include all required base headers', () => {
    const headers = buildAnthropicHeaders(token);

    expect(headers['x-stainless-lang']).toBe('js');
    expect(headers['x-stainless-package-version']).toBe('0.60.0');
    expect(headers['x-stainless-os']).toBe('MacOS');
    expect(headers['x-stainless-arch']).toBe('arm64');
    expect(headers['x-stainless-runtime']).toBe('node');
    expect(headers['x-app']).toBe('cli');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(headers.host).toBe('api.anthropic.com');
  });

  it('should include authorization header with Bearer token', () => {
    const headers = buildAnthropicHeaders(token);
    expect(headers.authorization).toBe(`Bearer ${token}`);
  });

  it('should trim token in authorization header', () => {
    const headers = buildAnthropicHeaders(`  ${token}  `);
    expect(headers.authorization).toBe(`Bearer ${token}`);
  });

  it('should include required beta headers', () => {
    const headers = buildAnthropicHeaders(token);
    const betas = headers['anthropic-beta'].split(',');

    for (const beta of REQUIRED_BETAS) {
      expect(betas).toContain(beta);
    }
  });

  it('should merge custom beta headers', () => {
    const customBetas = ['custom-beta-1', 'custom-beta-2'];
    const headers = buildAnthropicHeaders(token, {
      anthropicBetaHeaders: customBetas,
    });
    const betas = headers['anthropic-beta'].split(',');

    expect(betas).toContain('custom-beta-1');
    expect(betas).toContain('custom-beta-2');
    for (const beta of REQUIRED_BETAS) {
      expect(betas).toContain(beta);
    }
  });

  it('should deduplicate beta headers', () => {
    const headers = buildAnthropicHeaders(token, {
      anthropicBetaHeaders: ['claude-code-20250219'],
    });
    const betas = headers['anthropic-beta'].split(',');
    const uniqueBetas = [...new Set(betas)];

    expect(betas.length).toBe(uniqueBetas.length);
  });

  it('should use default user-agent when not provided', () => {
    const headers = buildAnthropicHeaders(token);
    expect(headers['user-agent']).toBe('claude-cli/2.1.22 (external, cli)');
  });

  it('should use provided user-agent when it starts with claude-cli/', () => {
    const customUserAgent = 'claude-cli/2.2.0 (custom)';
    const headers = buildAnthropicHeaders(token, {
      userAgent: customUserAgent,
    });
    expect(headers['user-agent']).toBe(customUserAgent);
  });

  it('should override with default user-agent when provided does not start with claude-cli/', () => {
    const customUserAgent = 'custom-agent/1.0';
    const headers = buildAnthropicHeaders(token, {
      userAgent: customUserAgent,
    });
    expect(headers['user-agent']).toBe('claude-cli/2.1.22 (external, cli)');
  });
});

describe('verifyOAuthToken', () => {
  it('should return invalid for malformed token', async () => {
    const result = await verifyOAuthToken('invalid-token');
    expect(result.isValid).toBe(false);
    expect(result.token).toBe('invalid-token');
  });

  it('should attempt API verification for valid format token', async () => {
    const token = 'sk-ant-oat01-PLACEHOLDER_TOKEN_USE_ENV_VAR';
    const result = await verifyOAuthToken(token);

    expect(result.token).toBe(token);
    expect(typeof result.isValid).toBe('boolean');
  });

  it('given a forbidden probe response when verifying then it returns invalid', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async (..._args: Parameters<typeof fetch>) => new Response('forbidden', { status: 403 }),
      { preconnect: originalFetch.preconnect }
    );

    const result = await verifyOAuthToken('sk-ant-oat01-test123');

    expect(result.isValid).toBe(false);
    globalThis.fetch = originalFetch;
  });
});

describe('RateLimitError', () => {
  it('should create error with retry after seconds', () => {
    const error = new RateLimitError('Rate limit exceeded', 429, 60);
    expect(error.message).toBe('Rate limit exceeded');
    expect(error.statusCode).toBe(429);
    expect(error.retryAfterSeconds).toBe(60);
    expect(error.name).toBe('RateLimitError');
  });

  it('should create error without retry after', () => {
    const error = new RateLimitError('Rate limit exceeded');
    expect(error.retryAfterSeconds).toBeNull();
  });

  it('should use default status code 429', () => {
    const error = new RateLimitError('Rate limit exceeded');
    expect(error.statusCode).toBe(429);
  });
});

describe('AuthenticationError', () => {
  it('should create authentication error', () => {
    const error = new AuthenticationError('Invalid credentials');
    expect(error.message).toBe('Invalid credentials');
    expect(error.name).toBe('AuthenticationError');
  });
});

describe('Required beta headers', () => {
  it('should contain all required Claude Code betas', () => {
    expect(REQUIRED_BETAS).toContain('claude-code-20250219');
    expect(REQUIRED_BETAS).toContain('oauth-2025-04-20');
    expect(REQUIRED_BETAS).toContain('interleaved-thinking-2025-05-14');
  });
});

describe('BASE_X_HEADERS', () => {
  it('should contain x-app header set to cli', () => {
    expect(BASE_X_HEADERS['x-app']).toBe('cli');
  });

  it('should contain x-stainless headers', () => {
    expect(BASE_X_HEADERS['x-stainless-lang']).toBeDefined();
    expect(BASE_X_HEADERS['x-stainless-os']).toBeDefined();
    expect(BASE_X_HEADERS['x-stainless-arch']).toBeDefined();
    expect(BASE_X_HEADERS['x-stainless-runtime']).toBeDefined();
  });
});

afterEach(async () => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  await rm(sandboxRoot, { recursive: true, force: true });
});
