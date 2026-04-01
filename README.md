# not-claude-code-emulator

OAuth proxy server built with [Hono](https://hono.dev) and [Bun](https://bun.sh). Provides an OpenAPI-documented Messages API with built-in token management and streaming support.

## Install

Prerequisites: [Bun](https://bun.sh) and [GitHub CLI](https://cli.github.com).

```bash
npm install -g not-claude-code-emulator
not-claude-code-emulator install
```

Use the published npm package for setup. Do not use a source checkout for installation.

## Usage

```bash
not-claude-code-emulator start
```

Server endpoints:

| Endpoint     | URL                                |
| ------------ | ---------------------------------- |
| Docs         | http://localhost:3000/docs         |
| OpenAPI Spec | http://localhost:3000/openapi.json |
| Messages API | http://localhost:3000/v1/messages  |
| Health       | http://localhost:3000/health       |

### Environment Variables

| Variable            | Default     | Description                  |
| ------------------- | ----------- | ---------------------------- |
| `PORT`              | `3000`      | Server port                  |
| `HOST`              | `localhost` | Server host                  |
| `DISABLE_TELEMETRY` | —           | Set `1` to disable telemetry |

## Development

```bash
bun run dev          # start with --watch
bun run typecheck    # type check
bun test             # run tests
bun run build        # build
bun run lint         # check formatting
bun run format       # auto-format
```
