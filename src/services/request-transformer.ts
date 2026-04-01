import { createHash } from 'crypto';
import type { MessageCreateParams } from '../types/messages.js';

// Allowed headers for pass-through (report.md based)
const ALLOWED_HEADERS = [
  'accept',
  'accept-encoding',
  'anthropic-beta',
  'anthropic-dangerous-direct-browser-access',
  'anthropic-version',
  'authorization',
  'cf-connecting-ip',
  'content-length',
  'content-type',
  'host',
  'user-agent',
  'x-app',
  'x-stainless-arch',
  'x-stainless-helper-method',
  'x-stainless-lang',
  'x-stainless-os',
  'x-stainless-package-version',
  'x-stainless-retry-count',
  'x-stainless-runtime',
  'x-stainless-runtime-version',
  'x-stainless-timeout',
] as const;

export interface TransformedRequest {
  requestBody: MessageCreateParams;
  anthropicBetaHeaders: string[];
  headers: Record<string, string>;
}

interface TransformContext {
  body: unknown;
  headers: Record<string, string | undefined>;
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * Filter headers based on allowlist
 */
function filterHeaders(headers: Record<string, string | undefined>): Record<string, string> {
  const filtered: Record<string, string> = {};

  for (const key of ALLOWED_HEADERS) {
    const value = headers[key];
    if (value !== undefined && value !== null) {
      filtered[key] = value;
    }
  }

  return filtered;
}

/**
 * Parse beta headers from request
 */
function parseBetaHeaders(headers: Record<string, string | undefined>): string[] {
  const clientBetaHeaders = headers['anthropic-beta'];
  if (!clientBetaHeaders) return [];

  return clientBetaHeaders.split(',').map((beta) => beta.trim());
}

/**
 * Parse model string to extract thinking spec
 */
function parseModelString(modelString: string): {
  model: string;
  thinkingSpec: number | 'high' | 'medium' | 'low' | 'none' | null;
} {
  const colonIndex = modelString.indexOf(':');
  if (colonIndex === -1) {
    return { model: modelString, thinkingSpec: null };
  }

  const model = modelString.substring(0, colonIndex);
  const spec = modelString.substring(colonIndex + 1);

  const numSpec = Number.parseInt(spec, 10);
  if (!isNaN(numSpec)) {
    return { model, thinkingSpec: numSpec };
  }

  const lowerSpec = spec.toLowerCase();
  if (
    lowerSpec === 'high' ||
    lowerSpec === 'medium' ||
    lowerSpec === 'low' ||
    lowerSpec === 'none'
  ) {
    return { model, thinkingSpec: lowerSpec };
  }

  return { model: modelString, thinkingSpec: null };
}

/**
 * Create thinking config from spec
 */
function createThinkingConfig(
  spec: number | 'high' | 'medium' | 'low' | 'none',
  maxTokens: number
): { type: 'enabled'; budget_tokens: number } | undefined {
  if (spec === 'none') return undefined;

  let budgetTokens: number;

  if (typeof spec === 'number') {
    budgetTokens = Math.max(spec, 1024);
  } else {
    const effortRatios: Record<'high' | 'medium' | 'low', number> = {
      high: 0.8,
      medium: 0.5,
      low: 0.2,
    };
    const ratio = effortRatios[spec];
    budgetTokens = Math.max(Math.min(Math.floor(maxTokens * ratio), 32000), 1024);
  }

  return {
    type: 'enabled' as const,
    budget_tokens: budgetTokens,
  };
}

/**
 * Apply thinking configuration to request
 */
function applyThinkingConfig(requestBody: MessageCreateParams): void {
  const { model, thinkingSpec } = parseModelString(requestBody.model);

  if (!requestBody.thinking && thinkingSpec !== null) {
    requestBody.model = model;

    const thinkingConfig = createThinkingConfig(thinkingSpec, requestBody.max_tokens);
    if (thinkingConfig) {
      requestBody.thinking = thinkingConfig;
    }
  } else if (thinkingSpec !== null) {
    requestBody.model = model;
  }
}

/**
 * Apply temperature adjustment for thinking mode
 */
function applyTemperatureForThinking(requestBody: MessageCreateParams): void {
  if (requestBody.thinking?.type === 'enabled') {
    requestBody.temperature = 1;
  }
}

/**
 * Find longest cache TTL from existing system blocks
 */
function findLongestCacheTtl(system: MessageCreateParams['system']): '1h' | '5m' | undefined {
  if (!system || !Array.isArray(system)) return undefined;

  let hasOneHour = false;
  let hasFiveMin = false;

  for (const block of system) {
    if ('cache_control' in block && block.cache_control) {
      const ttl = (block.cache_control as { ttl?: string }).ttl;
      if (ttl === '1h') {
        hasOneHour = true;
      } else if (ttl === '5m' || ttl === undefined) {
        hasFiveMin = true;
      }
    }
  }

  if (hasOneHour) return '1h';
  if (hasFiveMin) return '5m';
  return undefined;
}

/**
 * Hardcoded salt from backend validation.
 * Must match exactly for fingerprint validation to pass.
 */
const FINGERPRINT_SALT = '59cf53e54c78';

/**
 * The emulated Claude CLI version reported in attribution headers
 * and user-agent strings.
 */
const EMULATED_CLI_VERSION = '2.1.87';

/**
 * Extract the text content from the first user message in the request.
 */
function extractFirstUserMessageText(messages: MessageCreateParams['messages']): string {
  if (!messages || messages.length === 0) return '';

  const firstUserMsg = messages.find((m) => m.role === 'user');
  if (!firstUserMsg) return '';

  const content = firstUserMsg.content;
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    const textBlock = content.find(
      (block) => typeof block === 'object' && block !== null && block.type === 'text'
    );
    if (textBlock && 'text' in textBlock) {
      return textBlock.text as string;
    }
  }

  return '';
}

/**
 * Compute the 3-character fingerprint used in the attribution header.
 *
 * Algorithm: SHA256(SALT + msg[4] + msg[7] + msg[20] + version)[:3]
 *
 * This replicates the fingerprint logic from the real Claude Code client
 * (see src/utils/fingerprint.ts in the leaked source).
 */
export function computeFingerprint(messageText: string, version: string): string {
  const indices = [4, 7, 20];
  const chars = indices.map((i) => messageText[i] || '0').join('');

  const fingerprintInput = `${FINGERPRINT_SALT}${chars}${version}`;
  const hash = createHash('sha256').update(fingerprintInput).digest('hex');
  return hash.slice(0, 3);
}

/**
 * Build the x-anthropic-billing-header string that Claude Code injects
 * into the first system prompt block.
 *
 * Format:
 *   x-anthropic-billing-header: cc_version=VERSION.FINGERPRINT; cc_entrypoint=cli;
 *
 * The real Claude Code binary conditionally includes a `cch=00000` placeholder
 * when the NATIVE_CLIENT_ATTESTATION compile-time feature flag is enabled.
 * Bun's native HTTP stack (Zig) then overwrites the zeros with a computed
 * attestation hash before the request leaves the process.
 *
 * Since NATIVE_CLIENT_ATTESTATION is a compile-time flag only present in
 * the official Bun-bundled binary, and the attestation hash cannot be forged
 * from JS userland, we intentionally omit the cch field — matching the
 * behavior of non-official builds where the feature flag evaluates to false.
 */
export function getAttributionHeader(fingerprint: string): string {
  const version = `${EMULATED_CLI_VERSION}.${fingerprint}`;
  return `x-anthropic-billing-header: cc_version=${version}; cc_entrypoint=cli;`;
}

function injectClaudeCodeSystemMessage(requestBody: MessageCreateParams): void {
  const spoofText = "You are Claude Code, Anthropic's official CLI for Claude.";
  const spoofTextNew = "You are a Claude agent, built on Anthropic's Claude Agent SDK.";

  // Compute fingerprint from the first user message and build the
  // attribution header, mirroring what the real Claude Code binary does.
  const firstMsgText = extractFirstUserMessageText(requestBody.messages);
  const fingerprint = computeFingerprint(firstMsgText, EMULATED_CLI_VERSION);
  const attributionHeader = getAttributionHeader(fingerprint);

  const longestTtl = findLongestCacheTtl(requestBody.system);

  const cacheControl = longestTtl
    ? { type: 'ephemeral' as const, ttl: longestTtl }
    : { type: 'ephemeral' as const };

  const claudeCodeSpoofElement = {
    type: 'text' as const,
    text: `${spoofText}\n${attributionHeader}`,
    cache_control: cacheControl,
  };

  if ('system' in requestBody && requestBody.system) {
    const existingSystem = requestBody.system;

    if (Array.isArray(existingSystem)) {
      let systemToUse = existingSystem;
      if (
        existingSystem.length > 0 &&
        existingSystem[0]?.type === 'text' &&
        ((existingSystem[0] as { text?: string }).text?.includes(spoofText) ||
          (existingSystem[0] as { text?: string }).text?.includes(spoofTextNew))
      ) {
        systemToUse = existingSystem.slice(1);
      }
      requestBody.system = [claudeCodeSpoofElement, ...systemToUse];
    } else {
      const existingSystemElement = {
        type: 'text' as const,
        text: existingSystem as string,
        cache_control: cacheControl,
      };
      requestBody.system = [claudeCodeSpoofElement, existingSystemElement];
    }
  } else {
    requestBody.system = [claudeCodeSpoofElement];
  }
}

/**
 * Limit cache control blocks (Anthropic API max is 4)
 */
function limitCacheControlBlocks(request: MessageCreateParams, maxBlocks = 4): void {
  const cacheBlocks: unknown[] = [];

  if (request.messages) {
    for (const msg of request.messages) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (
            typeof block === 'object' &&
            block !== null &&
            'cache_control' in block &&
            block.cache_control != null
          ) {
            cacheBlocks.push(block);
          }
        }
      }
    }
  }

  if (Array.isArray(request.system)) {
    for (const block of request.system) {
      if (
        typeof block === 'object' &&
        block !== null &&
        'cache_control' in block &&
        block.cache_control != null
      ) {
        cacheBlocks.push(block);
      }
    }
  }

  if (cacheBlocks.length <= maxBlocks) return;

  const keepFirst = cacheBlocks[0];
  const keepLast = cacheBlocks.slice(-(maxBlocks - 1));
  const toKeep = new Set([keepFirst, ...keepLast]);

  for (const block of cacheBlocks) {
    if (!toKeep.has(block)) {
      delete (block as { cache_control?: unknown }).cache_control;
    }
  }
}

/**
 * Main request transformation function
 */
export async function transformRequest(ctx: TransformContext): Promise<TransformedRequest> {
  // 1. Extract beta headers
  const anthropicBetaHeaders = parseBetaHeaders(ctx.headers);

  // 2. Copy request body
  const requestBody = { ...(ctx.body as MessageCreateParams) };

  // 3. Apply thinking configuration
  applyThinkingConfig(requestBody);

  // 4. Adjust temperature for thinking
  applyTemperatureForThinking(requestBody);

  // 5. Inject Claude Code system message
  injectClaudeCodeSystemMessage(requestBody);

  // 6. Limit cache control blocks
  limitCacheControlBlocks(requestBody, 4);

  const headers = filterHeaders(ctx.headers);

  return {
    requestBody,
    anthropicBetaHeaders,
    headers,
  };
}
