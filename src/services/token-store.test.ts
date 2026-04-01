import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  getTokenFilePath,
  loadStoredTokens,
  normalizeStoredTokens,
  saveOAuthTokenOnly,
  saveStoredTokens,
} from './token-store.js';

const originalHome = process.env.HOME;
const sandboxRoot = join(process.cwd(), '.tmp-token-store-test');

describe('token-store', () => {
  beforeEach(async () => {
    process.env.HOME = sandboxRoot;
    await rm(sandboxRoot, { recursive: true, force: true });
    await mkdir(sandboxRoot, { recursive: true });
  });

  afterEach(async () => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await rm(sandboxRoot, { recursive: true, force: true });
  });

  it('given home directory when resolving token path then it uses the hardcoded anthropic q tokens json path', () => {
    expect(getTokenFilePath()).toBe(join(sandboxRoot, '.config', 'anthropic', 'q', 'tokens.json'));
  });

  it('given stored oauth tokens when saving and loading then it returns the same token shape', async () => {
    const tokens = {
      accessToken: 'sk-ant-oat01-access',
      refreshToken: 'refresh-token',
      expiresAt: 123456789,
      scopes: ['user:profile', 'user:inference'],
    };

    await saveStoredTokens(tokens);

    const loaded = await loadStoredTokens();

    expect(loaded).toEqual(tokens);
  });

  it('given stored oauth tokens when saving then it writes the token file with owner-only permissions', async () => {
    await saveStoredTokens({
      accessToken: 'sk-ant-oat01-access',
      refreshToken: 'refresh-token',
      expiresAt: 123456789,
      scopes: ['user:profile', 'user:inference'],
    });

    const fileStats = await stat(getTokenFilePath());

    expect(fileStats.mode & 0o777).toBe(0o600);
  });

  it('given oauth-token-only file when loading then it normalizes to an oauth token record', async () => {
    const filePath = getTokenFilePath();
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({ oauthToken: 'sk-ant-oat01-only' }));

    const loaded = await loadStoredTokens();

    expect(loaded).toEqual({
      accessToken: 'sk-ant-oat01-only',
      refreshToken: null,
      expiresAt: null,
      scopes: ['user:inference'],
    });
  });

  it('given an oauth token when saving oauth-token-only then it writes the oauthToken shape', async () => {
    await saveOAuthTokenOnly('sk-ant-oat01-only');

    const filePath = getTokenFilePath();
    const content = await readFile(filePath, 'utf8');

    expect(JSON.parse(content)).toMatchObject({
      oauthToken: 'sk-ant-oat01-only',
    });
  });

  it('given invalid token content when normalizing then it returns null', () => {
    expect(normalizeStoredTokens({})).toBeNull();
    expect(normalizeStoredTokens(null)).toBeNull();
  });
});
