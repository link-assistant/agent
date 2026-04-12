import { Log } from './log';

/**
 * Token estimation utilities.
 *
 * Provides two levels of accuracy:
 *
 * 1. **Real BPE tokenization** via `gpt-tokenizer` (o200k_base encoding) —
 *    accurate for OpenAI-compatible models (GPT-4o, GPT-4.1, GPT-5, etc.).
 *    Used by `countTokens()` when available.
 *
 * 2. **Character-based heuristic** (≈4 chars per token for English text) —
 *    fallback for models with unknown tokenizers (Nvidia Nemotron, Google Gemini,
 *    Meta Llama, etc.). Their tokenizers use custom SentencePiece BPE vocabularies
 *    that are not available as JS libraries.
 *
 * For compaction/overflow decisions, the heuristic is sufficient because:
 * - The 75% safety margin (25% buffer) absorbs estimation inaccuracy
 * - The `capOutputTokensToContext` function caps output tokens as a last defense
 * - Even real tokenizers would be wrong for non-OpenAI models
 *
 * @see https://github.com/link-assistant/agent/issues/249
 */
export namespace Token {
  const log = Log.create({ service: 'token' });

  /** Default characters-per-token ratio for the heuristic estimator. */
  const CHARS_PER_TOKEN = 4;

  /**
   * Heuristic token estimation based on character count.
   * Returns an approximate token count using the ~4 chars/token rule of thumb.
   * This is accurate to within ±20% for typical English text across most LLM
   * tokenizers (OpenAI, Nemotron, Llama, Gemini all average 3.5–4.5 chars/token
   * for English).
   */
  export function estimate(input: string) {
    return Math.max(0, Math.round((input || '').length / CHARS_PER_TOKEN));
  }

  /**
   * Lazy-loaded BPE encoder instance. Uses o200k_base encoding (GPT-4o/GPT-4.1/GPT-5).
   * Loaded on first call to `countTokens()`. Returns `null` if gpt-tokenizer is
   * not available.
   */
  let _encoder: { encode: (text: string) => number[] } | null | undefined;

  function getEncoder(): { encode: (text: string) => number[] } | null {
    if (_encoder !== undefined) return _encoder;
    try {
      // Dynamic import to keep gpt-tokenizer optional.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('gpt-tokenizer/encoding/o200k_base');
      _encoder = mod;
      log.info(() => ({ message: 'loaded gpt-tokenizer (o200k_base)' }));
      return _encoder;
    } catch {
      _encoder = null;
      log.info(() => ({
        message:
          'gpt-tokenizer not available, using character-based estimation',
      }));
      return null;
    }
  }

  /**
   * Count tokens using real BPE tokenization when available, falling back to
   * the character-based heuristic.
   *
   * Use this for critical paths where accuracy matters (overflow detection,
   * output token capping). For logging or non-critical estimation, prefer
   * the cheaper `estimate()`.
   *
   * @returns An object with the token count and whether real BPE was used.
   */
  export function countTokens(input: string): {
    count: number;
    precise: boolean;
  } {
    if (!input) return { count: 0, precise: true };
    const encoder = getEncoder();
    if (encoder) {
      try {
        const tokens = encoder.encode(input);
        return { count: tokens.length, precise: true };
      } catch (e) {
        log.warn(() => ({
          message: 'BPE encoding failed, falling back to estimate',
          error: String(e),
          inputLength: input.length,
        }));
      }
    }
    return { count: estimate(input), precise: false };
  }
}
