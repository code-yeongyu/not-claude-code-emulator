#!/usr/bin/env bun
import { createInterface } from 'node:readline';
import chalk from 'chalk';
import { Command } from 'commander';
import { ensureProjectStarConsent } from './services/install-consent.js';
import {
  callAnthropicApi,
  resolveOAuthToken,
  validateOAuthToken,
  verifyOAuthToken,
} from './services/oauth-client.js';
import { OAuthService } from './services/oauth-flow.js';
import {
  clearStoredTokens,
  getTokenFilePath,
  saveOAuthTokenOnly,
  saveStoredTokens,
} from './services/token-store.js';

function startManualCodeCapture(oauthService: OAuthService): () => void {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.setPrompt('Paste code here if prompted > ');
  rl.prompt();
  rl.on('line', (line) => {
    const value = line.trim();
    if (!value.includes('#')) {
      rl.prompt();
      return;
    }

    const [authorizationCode, state] = value.split('#');
    if (!authorizationCode || !state) {
      rl.prompt();
      return;
    }

    if (!oauthService.handleManualAuthCodeInput({ authorizationCode, state })) {
      console.log(chalk.red('Invalid authorization code or state.'));
      rl.prompt();
    }
  });

  return () => {
    rl.close();
  };
}

async function runOAuthLogin(options: {
  loginWithClaudeAi: boolean;
  setupToken: boolean;
  loginHint?: string;
  loginMethod?: string;
}): Promise<void> {
  const oauthService = new OAuthService();
  const stopManualCapture = startManualCodeCapture(oauthService);

  try {
    const tokens = await oauthService.startOAuthFlow(
      async (manualUrl) => {
        console.log(chalk.blue('Opening browser to sign in…'));
        console.log(chalk.gray(`If the browser does not open, visit: ${manualUrl}`));
      },
      {
        loginWithClaudeAi: options.loginWithClaudeAi,
        loginHint: options.loginHint,
        loginMethod: options.loginMethod,
        inferenceOnly: options.setupToken,
        expiresIn: options.setupToken ? 365 * 24 * 60 * 60 : undefined,
      }
    );

    if (options.setupToken) {
      await saveOAuthTokenOnly(tokens.accessToken);
    } else {
      await saveStoredTokens(tokens);
    }

    console.log(chalk.green('✅ OAuth login completed'));
    console.log(chalk.gray(`Stored tokens at: ${getTokenFilePath()}`));

    if (options.setupToken) {
      console.log(chalk.gray('Created long-lived token using the setup-token flow.'));
      console.log(chalk.yellow(tokens.accessToken));
    }
  } finally {
    stopManualCapture();
    oauthService.cleanup();
  }
}

const program = new Command();

program
  .name('not-claude-code-emulator')
  .description('CLI for managing not-claude-code-emulator')
  .version('1.0.0');

program
  .command('install')
  .description('Run the first-time installer and OAuth setup')
  .action(async () => {
    await ensureProjectStarConsent({
      interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
      allowRetry: true,
    });
    console.log(chalk.blue('🔧 Running installer...'));
    await runOAuthLogin({
      loginWithClaudeAi: true,
      setupToken: false,
    });
    console.log(chalk.green('✅ Installation completed'));
    console.log(chalk.gray('Next step: bun run dev'));
  });

program
  .command('login')
  .description('Sign in with the Claude OAuth flow and persist tokens')
  .option('--console', 'Use Console login instead of Claude subscription login')
  .option('--claudeai', 'Use Claude subscription login')
  .option('--email <email>', 'Prefill the login email')
  .option('--sso', 'Request SSO login')
  .action(async (options) => {
    if (options.console && options.claudeai) {
      console.error('Error: --console and --claudeai cannot be used together.');
      process.exit(1);
    }

    await runOAuthLogin({
      loginWithClaudeAi: options.console ? false : true,
      setupToken: false,
      loginHint: options.email,
      loginMethod: options.sso ? 'sso' : undefined,
    });
  });

program
  .command('setup-token')
  .description('Create a long-lived OAuth token and persist it')
  .action(async () => {
    await runOAuthLogin({
      loginWithClaudeAi: true,
      setupToken: true,
    });
  });

program
  .command('logout')
  .description('Clear persisted OAuth tokens')
  .action(async () => {
    await clearStoredTokens();
    console.log(chalk.green('✅ Cleared persisted OAuth tokens'));
  });

program
  .command('verify-token')
  .description('Verify an OAuth token')
  .option('-t, --token <token>', 'OAuth token to verify')
  .action(async (options) => {
    const token = options.token ?? (await resolveOAuthToken());

    if (!token) {
      console.error(chalk.red('❌ Error: No token provided'));
      console.log(chalk.yellow('Usage: cli verify-token --token <token>'));
      console.log(chalk.yellow('Or set ANTHROPIC_OAUTH_TOKEN environment variable'));
      process.exit(1);
    }

    console.log(chalk.blue('🔍 Verifying OAuth token...'));
    console.log(chalk.gray(`Token: ${token.slice(0, 30)}...`));

    const isValidFormat = validateOAuthToken(token);
    console.log(chalk.gray(`Format valid: ${isValidFormat ? '✅' : '❌'}`));

    if (!isValidFormat) {
      console.error(chalk.red('❌ Token format is invalid'));
      console.log(chalk.yellow('Expected format: sk-ant-oat01-...'));
      process.exit(1);
    }

    console.log(chalk.blue('🌐 Testing token against Anthropic API...'));
    const result = await verifyOAuthToken(token);

    if (result.isValid) {
      console.log(chalk.green('✅ Token is valid and working!'));
    } else {
      console.error(chalk.red('❌ Token verification failed'));
      process.exit(1);
    }
  });

program
  .command('test-request')
  .description('Send a test request to verify the token works')
  .option('-t, --token <token>', 'OAuth token to use')
  .action(async (options) => {
    const token = options.token ?? (await resolveOAuthToken());

    if (!token) {
      console.error(chalk.red('❌ Error: No token provided'));
      process.exit(1);
    }

    console.log(chalk.blue('📤 Sending test request...'));

    try {
      const response = await callAnthropicApi(
        '/v1/messages?beta=true',
        {
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 100,
          messages: [{ role: 'user', content: 'Say hello' }],
        },
        token
      );

      if (response.ok) {
        const data = await response.json();
        console.log(chalk.green('✅ Request successful!'));
        console.log(chalk.gray('Response:'));
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.error(chalk.red(`❌ Request failed: ${response.status}`));
        const error = await response.text();
        console.error(chalk.red(error));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('❌ Error sending request:'));
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('start')
  .description('Start the server')
  .option('-p, --port <port>', 'Port to run on', '3000')
  .option('-h, --host <host>', 'Host to bind to', 'localhost')
  .action(async (options) => {
    process.env.PORT = options.port;
    process.env.HOST = options.host;

    console.log(chalk.blue('🚀 Starting server...'));
    await import('./index.js');
  });

program
  .command('health')
  .description('Check server health')
  .option('-u, --url <url>', 'Server URL', 'http://localhost:3000')
  .action(async (options) => {
    try {
      const response = await fetch(`${options.url}/health`);
      if (response.ok) {
        const data = await response.json();
        console.log(chalk.green('✅ Server is healthy'));
        console.log(chalk.gray(JSON.stringify(data, null, 2)));
      } else {
        console.error(chalk.red(`❌ Server unhealthy: ${response.status}`));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('❌ Cannot reach server:'));
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program.hook('preAction', async (_thisCommand, actionCommand) => {
  if (actionCommand.name() === 'install') {
    return;
  }

  await ensureProjectStarConsent({
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  });
});

await program.parseAsync().catch((error) => {
  console.error(chalk.red(`❌ ${error instanceof Error ? error.message : String(error)}`));
  process.exit(1);
});
