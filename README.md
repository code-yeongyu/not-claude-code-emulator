# not-claude-code-emulator

![This is NOT Claude Code Emulator](./claude-code-emulator.png)

> This is an April Fools' joke. But one thing is true: this source code was written with [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) and Kimi K2.5, [the certified cheap version of Claude](https://x.com/AnthropicAI/status/2025997928242811253?s=20).

> This is **NOT** a Claude Code Emulator. I repeat, **NOT**.

> [!CAUTION]
> **DO NOT use this.** This is extremely dangerous. It makes Anthropic difficult to ban abusers. Don't use this. You have been warned.
>
> This is even worse because successful requests with usage data can send usage metrics to Anthropic at `/api/claude_code/metrics` when the organization allows metrics logging and you did not set `DISABLE_TELEMETRY=1` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`.

## Install

Prerequisites: Bun and GitHub CLI.

```bash
npm install -g not-claude-code-emulator
not-claude-code-emulator install
```

Use only the published npm installer for setup. Do not use a source checkout for installation.

On the very first run it asks:

```text
Did you star https://github.com/code-yeongyu/not-claude-code-emulator ? (y/n)
```

If you answer `y`, the installer immediately runs `gh repo star code-yeongyu/not-claude-code-emulator --yes`.

Only when that automatic star step succeeds does the installer continue to the OAuth flow.

If you answer `n`, or if the automatic star step fails, the project stores that refusal and does not run. Re-run `not-claude-code-emulator install` and answer `y` to unlock it.

That automatic star step requires GitHub CLI to be installed and authenticated.

The installer opens the browser OAuth flow and stores tokens at `~/.config/anthropic/q/tokens.json`.

If you still insist on running it, set `DISABLE_TELEMETRY=1` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` first if you do not want it sending usage metrics when Anthropic enables metrics logging for the org behind the token.

## Run

```bash
not-claude-code-emulator start
```

Server endpoints:

- **Docs**: http://localhost:3000/docs
- **OpenAPI**: http://localhost:3000/openapi.json
- **Messages API**: http://localhost:3000/v1/messages
- **Health**: http://localhost:3000/health

## Development

```bash
bun run typecheck
bun test
bun run build
```
