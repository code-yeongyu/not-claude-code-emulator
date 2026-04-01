import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { OAuthTokens } from '../types/oauth.js';

type StoredTokenFile = Partial<OAuthTokens> & {
  oauthToken?: string;
  updatedAt?: string;
};

const DEFAULT_SCOPES = ['user:inference'];

export function getTokenFilePath(): string {
  return join(process.env.HOME ?? homedir(), '.config', 'anthropic', 'q', 'tokens.json');
}

export function normalizeStoredTokens(value: unknown): OAuthTokens | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as StoredTokenFile;
  const accessToken =
    typeof record.accessToken === 'string'
      ? record.accessToken
      : typeof record.oauthToken === 'string'
        ? record.oauthToken
        : null;

  if (!accessToken) {
    return null;
  }

  return {
    accessToken,
    refreshToken: typeof record.refreshToken === 'string' ? record.refreshToken : null,
    expiresAt: typeof record.expiresAt === 'number' ? record.expiresAt : null,
    scopes:
      Array.isArray(record.scopes) && record.scopes.every((scope) => typeof scope === 'string')
        ? record.scopes
        : DEFAULT_SCOPES,
  };
}

export async function loadStoredTokens(): Promise<OAuthTokens | null> {
  try {
    const content = await readFile(getTokenFilePath(), 'utf8');
    return normalizeStoredTokens(JSON.parse(content));
  } catch {
    return null;
  }
}

export async function saveStoredTokens(tokens: OAuthTokens): Promise<void> {
  const filePath = getTokenFilePath();
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  await chmod(dirname(filePath), 0o700);
  await writeFile(
    filePath,
    JSON.stringify(
      {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
  await chmod(filePath, 0o600);
}

export async function saveOAuthTokenOnly(accessToken: string): Promise<void> {
  const filePath = getTokenFilePath();
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  await chmod(dirname(filePath), 0o700);
  await writeFile(
    filePath,
    JSON.stringify(
      {
        oauthToken: accessToken,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
  await chmod(filePath, 0o600);
}

export async function clearStoredTokens(): Promise<void> {
  try {
    await rm(getTokenFilePath(), { force: true });
  } catch {
    return;
  }
}
