import { afterEach, describe, expect, it } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveOAuthToken } from './oauth-client.js';
import { saveStoredTokens } from './token-store.js';

const originalHome = process.env.HOME;
const sandboxRoot = join(process.cwd(), '.tmp-oauth-client-opencode-placeholder-test');

describe('resolveOAuthToken with OpenCode placeholder keys', () => {
  afterEach(async () => {
    process.env.HOME = originalHome;
    delete process.env.ANTHROPIC_OAUTH_TOKEN;
    await rm(sandboxRoot, { recursive: true, force: true });
  });

  it('given a placeholder x-api-key and local fallback when resolving then it returns the stored token', async () => {
    process.env.HOME = sandboxRoot;
    await saveStoredTokens({
      accessToken: 'sk-ant-oat01-stored-token',
      refreshToken: null,
      expiresAt: null,
      scopes: ['user:inference'],
    });

    const token = await resolveOAuthToken(
      { 'x-api-key': 'YOUR_OAUTH_TOKEN_HERE' },
      { allowStoredTokenFallback: true }
    );

    expect(token).toBe('sk-ant-oat01-stored-token');
  });
});
