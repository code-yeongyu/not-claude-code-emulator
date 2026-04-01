import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ensureProjectStarConsent,
  getInstallConsentFilePath,
  loadInstallConsent,
  PROJECT_STAR_DECLINED_ERROR,
  PROJECT_STAR_FAILED_ERROR,
  PROJECT_STAR_REQUIRED_ERROR,
} from './install-consent.js';

const originalHome = process.env.HOME;
const sandboxRoot = join(process.cwd(), '.tmp-install-consent-test');

describe('install-consent', () => {
  beforeEach(async () => {
    process.env.HOME = sandboxRoot;
    await rm(sandboxRoot, { recursive: true, force: true });
  });

  afterEach(async () => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await rm(sandboxRoot, { recursive: true, force: true });
  });

  it('given approved consent when ensuring star consent then it stores the approval', async () => {
    await ensureProjectStarConsent({
      interactive: true,
      prompt: async () => true,
      starProject: async () => undefined,
    });

    const storedConsent = await loadInstallConsent();
    const rawContent = await readFile(getInstallConsentFilePath(), 'utf8');

    expect(storedConsent?.starred).toBe(true);
    expect(JSON.parse(rawContent)).toMatchObject({ starred: true });
  });

  it('given declined consent when ensuring star consent then it stores the refusal and rejects', async () => {
    await expect(
      ensureProjectStarConsent({
        interactive: true,
        prompt: async () => false,
        starProject: async () => undefined,
      })
    ).rejects.toThrow(PROJECT_STAR_DECLINED_ERROR);

    const storedConsent = await loadInstallConsent();

    expect(storedConsent?.starred).toBe(false);
  });

  it('given stored approval when ensuring star consent then it does not prompt again', async () => {
    await ensureProjectStarConsent({
      interactive: true,
      prompt: async () => true,
      starProject: async () => undefined,
    });

    await expect(
      ensureProjectStarConsent({
        interactive: true,
        prompt: async () => {
          throw new Error('prompt should not run');
        },
      })
    ).resolves.toBeUndefined();
  });

  it('given no consent and no interactive terminal when ensuring star consent then it rejects', async () => {
    await expect(ensureProjectStarConsent({ interactive: false })).rejects.toThrow(
      PROJECT_STAR_REQUIRED_ERROR
    );
  });

  it('given stored refusal when ensuring star consent then it keeps rejecting', async () => {
    await expect(
      ensureProjectStarConsent({
        interactive: true,
        prompt: async () => false,
        starProject: async () => undefined,
      })
    ).rejects.toThrow(PROJECT_STAR_DECLINED_ERROR);

    await expect(ensureProjectStarConsent({ interactive: true })).rejects.toThrow(
      PROJECT_STAR_DECLINED_ERROR
    );
  });

  it('given stored refusal when ensuring star consent with retry then it re-prompts and stores approval', async () => {
    await expect(
      ensureProjectStarConsent({
        interactive: true,
        prompt: async () => false,
        starProject: async () => undefined,
      })
    ).rejects.toThrow(PROJECT_STAR_DECLINED_ERROR);

    await expect(
      ensureProjectStarConsent({
        interactive: true,
        allowRetry: true,
        prompt: async () => true,
        starProject: async () => undefined,
      })
    ).resolves.toBeUndefined();

    const storedConsent = await loadInstallConsent();

    expect(storedConsent?.starred).toBe(true);
  });

  it('given automatic starring failure when ensuring star consent then it stores refusal and rejects', async () => {
    await expect(
      ensureProjectStarConsent({
        interactive: true,
        prompt: async () => true,
        starProject: async () => {
          throw new Error('boom');
        },
      })
    ).rejects.toThrow(PROJECT_STAR_FAILED_ERROR);

    const storedConsent = await loadInstallConsent();

    expect(storedConsent?.starred).toBe(false);
  });
});
