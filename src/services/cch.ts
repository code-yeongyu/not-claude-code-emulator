/**
 * CCH (Claude Code Hash) request signing module.
 *
 * Implements the xxHash64-based body integrity hash that the real Claude Code
 * binary computes in Bun's native HTTP stack (Zig). The algorithm was
 * reverse-engineered and documented at:
 * https://a10k.co/b/reverse-engineering-claude-code-cch.html
 *
 * Algorithm:
 * 1. Build the complete request body with `cch=00000` as placeholder
 * 2. Compute `xxHash64(body_bytes, seed) & 0xFFFFF`
 * 3. Format as zero-padded 5-character lowercase hex
 * 4. Replace `cch=00000` with the computed value in the body
 */
import xxhash from 'xxhash-wasm';

const CCH_SEED = 0x6e52736ac806831en;
const CCH_PLACEHOLDER = 'cch=00000';
const CCH_MASK = 0xfffffn;

let hasherPromise: ReturnType<typeof xxhash> | null = null;

function getHasher() {
  if (!hasherPromise) {
    hasherPromise = xxhash();
  }
  return hasherPromise;
}

/**
 * Compute the 5-character cch hash from the serialized request body.
 * The body must contain the `cch=00000` placeholder at this point.
 */
export async function computeCch(body: string): Promise<string> {
  const hasher = await getHasher();
  const hash = hasher.h64Raw(new TextEncoder().encode(body), CCH_SEED);
  return (hash & CCH_MASK).toString(16).padStart(5, '0');
}

/**
 * Replace the `cch=00000` placeholder with the computed hash value.
 */
export function replaceCchPlaceholder(body: string, cch: string): string {
  return body.replace(CCH_PLACEHOLDER, `cch=${cch}`);
}

/**
 * Check if a body string contains the cch placeholder.
 */
export function hasCchPlaceholder(body: string): boolean {
  return body.includes(CCH_PLACEHOLDER);
}
