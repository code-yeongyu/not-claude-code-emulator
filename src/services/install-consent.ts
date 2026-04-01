import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

type InstallConsentState = {
  starred: boolean;
  updatedAt: string;
};

export const PROJECT_STAR_REQUIRED_ERROR =
  'First-run star confirmation is required. Run `bun run cli install` in an interactive terminal and answer y to continue.';
export const PROJECT_STAR_DECLINED_ERROR =
  'You answered n to the star prompt. This project will not run until you re-run `bun run cli install` and answer y.';
export const PROJECT_STAR_FAILED_ERROR =
  'Automatic GitHub starring failed. Make sure GitHub CLI is installed and authenticated, then re-run the installer.';

const PROJECT_REPOSITORY = 'code-yeongyu/not-claude-code-emulator';

export function getInstallConsentFilePath(): string {
  return join(
    process.env.HOME ?? homedir(),
    '.config',
    'not-claude-code-emulator',
    'install-consent.json'
  );
}

export async function loadInstallConsent(): Promise<InstallConsentState | null> {
  try {
    const content = await readFile(getInstallConsentFilePath(), 'utf8');
    const parsed = JSON.parse(content) as Partial<InstallConsentState>;

    if (typeof parsed.starred !== 'boolean' || typeof parsed.updatedAt !== 'string') {
      return null;
    }

    return {
      starred: parsed.starred,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

async function saveInstallConsent(starred: boolean): Promise<void> {
  const filePath = getInstallConsentFilePath();
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  await chmod(dirname(filePath), 0o700);
  await writeFile(
    filePath,
    JSON.stringify(
      {
        starred,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
  await chmod(filePath, 0o600);
}

async function promptForStarConsent(): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    while (true) {
      const answer = await rl.question(
        'Did you star https://github.com/code-yeongyu/not-claude-code-emulator ? (y/n) '
      );
      const normalizedAnswer = answer.trim().toLowerCase();

      if (normalizedAnswer === 'y') {
        return true;
      }

      if (normalizedAnswer === 'n') {
        return false;
      }
    }
  } finally {
    rl.close();
  }
}

async function starProjectRepository(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const childProcess = spawn('gh', ['repo', 'star', PROJECT_REPOSITORY, '--yes'], {
      stdio: 'inherit',
    });

    childProcess.on('error', reject);
    childProcess.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`gh exited with code ${code ?? 'unknown'}`));
    });
  });
}

export async function ensureProjectStarConsent(
  options: {
    interactive?: boolean;
    prompt?: () => Promise<boolean>;
    allowRetry?: boolean;
    starProject?: () => Promise<void>;
  } = {}
): Promise<void> {
  const existingConsent = await loadInstallConsent();
  const allowRetry = options.allowRetry ?? false;

  if (existingConsent?.starred) {
    return;
  }

  if (existingConsent && !existingConsent.starred && !allowRetry) {
    throw new Error(PROJECT_STAR_DECLINED_ERROR);
  }

  const interactive = options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!interactive) {
    throw new Error(PROJECT_STAR_REQUIRED_ERROR);
  }

  const prompt = options.prompt ?? promptForStarConsent;
  const consented = await prompt();

  if (!consented) {
    await saveInstallConsent(false);
    throw new Error(PROJECT_STAR_DECLINED_ERROR);
  }

  const starProject = options.starProject ?? starProjectRepository;

  try {
    await starProject();
  } catch {
    await saveInstallConsent(false);
    throw new Error(PROJECT_STAR_FAILED_ERROR);
  }

  await saveInstallConsent(true);
}
