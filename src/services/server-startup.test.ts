import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getInstallConsentFilePath } from './install-consent.js';
import { saveStoredTokens } from './token-store.js';
import {
  SERVER_STARTUP_ERROR,
  SERVER_STARTUP_INVALID_TOKEN_ERROR,
  ensureServerStartupAuth,
} from './server-startup.js';

const originalHome = process.env.HOME;
const originalOAuthToken = process.env.ANTHROPIC_OAUTH_TOKEN;
const originalFetch = globalThis.fetch;
const sandboxRoot = join(process.cwd(), '.tmp-server-startup-test');

async function saveApprovedConsent(): Promise<void> {
  const filePath = getInstallConsentFilePath();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify({ starred: true, updatedAt: new Date().toISOString() }));
}

async function saveDeclinedConsent(): Promise<void> {
  const filePath = getInstallConsentFilePath();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify({ starred: false, updatedAt: new Date().toISOString() })
  );
}

describe('ensureServerStartupAuth', () => {
  afterEach(async () => {
    process.env.HOME = originalHome;
    if (originalOAuthToken === undefined) {
      delete process.env.ANTHROPIC_OAUTH_TOKEN;
    } else {
      process.env.ANTHROPIC_OAUTH_TOKEN = originalOAuthToken;
    }
    globalThis.fetch = originalFetch;
    await rm(sandboxRoot, { recursive: true, force: true });
  });

  it('given a valid env token when checking startup auth then it returns that token', async () => {
    process.env.ANTHROPIC_OAUTH_TOKEN = 'sk-ant-oat01-valid-env-token';
    process.env.HOME = sandboxRoot;
    await saveApprovedConsent();
    globalThis.fetch = Object.assign(
      async (..._args: Parameters<typeof fetch>) => new Response('{}', { status: 200 }),
      { preconnect: originalFetch.preconnect }
    );

    await expect(ensureServerStartupAuth()).resolves.toBe('sk-ant-oat01-valid-env-token');
  });

  it('given a stored token when checking startup auth then it returns the stored token', async () => {
    delete process.env.ANTHROPIC_OAUTH_TOKEN;
    process.env.HOME = sandboxRoot;
    await saveApprovedConsent();
    globalThis.fetch = Object.assign(
      async (..._args: Parameters<typeof fetch>) => new Response('{}', { status: 200 }),
      { preconnect: originalFetch.preconnect }
    );
    await saveStoredTokens({
      accessToken: 'sk-ant-oat01-stored-token',
      refreshToken: null,
      expiresAt: null,
      scopes: ['user:inference'],
    });

    await expect(ensureServerStartupAuth()).resolves.toBe('sk-ant-oat01-stored-token');
  });

  it('given no valid env or stored token when checking startup auth then it rejects', async () => {
    process.env.ANTHROPIC_OAUTH_TOKEN = 'YOUR_OAUTH_TOKEN_HERE';
    process.env.HOME = sandboxRoot;
    await saveApprovedConsent();

    await expect(ensureServerStartupAuth()).rejects.toThrow(SERVER_STARTUP_ERROR);
  });

  it('given an invalid stored token when checking startup auth then it rejects', async () => {
    delete process.env.ANTHROPIC_OAUTH_TOKEN;
    process.env.HOME = sandboxRoot;
    await saveApprovedConsent();
    globalThis.fetch = Object.assign(
      async (..._args: Parameters<typeof fetch>) => new Response('forbidden', { status: 401 }),
      { preconnect: originalFetch.preconnect }
    );
    await saveStoredTokens({
      accessToken: 'sk-ant-oat01-only',
      refreshToken: null,
      expiresAt: null,
      scopes: ['user:inference'],
    });

    await expect(ensureServerStartupAuth()).rejects.toThrow(SERVER_STARTUP_INVALID_TOKEN_ERROR);
  });

  it('given no stored star consent when checking startup auth then it rejects before auth', async () => {
    delete process.env.ANTHROPIC_OAUTH_TOKEN;
    process.env.HOME = sandboxRoot;

    await expect(ensureServerStartupAuth()).rejects.toThrow(
      'First-run star confirmation is required.'
    );
  });

  it('given declined star consent when checking startup auth then it rejects before auth', async () => {
    delete process.env.ANTHROPIC_OAUTH_TOKEN;
    process.env.HOME = sandboxRoot;
    await saveDeclinedConsent();

    await expect(ensureServerStartupAuth()).rejects.toThrow(
      'You answered n to the star prompt. This project will not run until you re-run'
    );
  });
});
