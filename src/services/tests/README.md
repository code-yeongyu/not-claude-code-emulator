# Test Suite

Comprehensive test suite for not-claude-code-emulator.

## Test Files

- `oauth-client.test.ts` - OAuth token validation, parsing, and header generation
- `request-transformer.test.ts` - Request transformation including:
  - Tool name transformation (snake_case → PascalCase)
  - Claude Code system prompt injection
  - OpenCode replacement handling
  - Thinking configuration parsing
  - Cache control block limiting
- `integration.test.ts` - End-to-end integration tests:
  - OpenCode system prompt API compatibility
  - Tool schema compatibility with OpenCode format
  - Real OAuth token verification
  - Header compatibility with Claude Code format
- `telemetry.test.ts` - Usage tracking and cost calculation

## Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test src/services/oauth-client.test.ts

# Run with coverage
bun test --coverage
```

## Test Results

✅ **89 tests passing** across 8 test files

### Key Test Coverage

1. **OAuth Token Validation**
   - Format validation (sk-ant-oat01-*)
   - Header parsing (Authorization Bearer vs x-api-key)
   - Token trimming

2. **OpenCode Compatibility**
   - System prompt keeps "OpenCode" unchanged
   - Tool names in snake_case are preserved on requests
   - Response-side tool normalization remains covered
   - Matches `../opencode` compatibility expectations

3. **Claude Code Headers**
   - x-app: cli
   - x-stainless-* headers for SDK compatibility
   - Required beta headers: claude-code-20250219, oauth-2025-04-20

4. **Request Transformation**
   - System prompt injection ("You are Claude Code...")
   - Thinking configuration from model string (model:2048, model:high)
   - Temperature adjustment when thinking enabled
   - Cache control block limiting (max 4)

5. **OAuth Login and Token Storage**
   - XDG token path handling
   - oauthToken-only persistence support
   - setup-token scope and expiry behavior
   - Stored-token resolution and auth failure handling

## Test Token

Tests use the OAuth token from environment variable `ANTHROPIC_OAUTH_TOKEN`.
Set your actual token before running tests:

```bash
export ANTHROPIC_OAUTH_TOKEN=sk-ant-oat01-YOUR_ACTUAL_TOKEN
```

This token is validated against the actual Anthropic API during integration tests.
