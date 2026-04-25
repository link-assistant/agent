/**
 * Centralized default-model accessor for integration tests.
 *
 * Re-exports the runtime defaults (`js/src/config/defaults.ts`) so test
 * files import a single source of truth for the model string used by
 * the agent and by sibling tools like `opencode`. Override at test time
 * via `LINK_ASSISTANT_AGENT_DEFAULT_MODEL` (matches the runtime env var).
 *
 * Tests should never hard-code provider/model strings; pull them from
 * here so a single change to `js/src/config/defaults.ts` (or a single
 * env-var override at run time) flows through every test in the tree.
 */
import {
  DEFAULT_MODEL,
  DEFAULT_MODEL_ENV,
  DEFAULT_COMPACTION_MODEL,
  DEFAULT_COMPACTION_MODEL_ENV,
  DEFAULT_COMPACTION_MODELS,
  DEFAULT_COMPACTION_MODELS_ENV,
  DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT,
  DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT_ENV,
  getDefaultModel,
  getDefaultCompactionModel,
  getDefaultCompactionModels,
  getDefaultCompactionSafetyMarginPercent,
} from '../../src/config/defaults.ts';

export {
  DEFAULT_MODEL,
  DEFAULT_MODEL_ENV,
  DEFAULT_COMPACTION_MODEL,
  DEFAULT_COMPACTION_MODEL_ENV,
  DEFAULT_COMPACTION_MODELS,
  DEFAULT_COMPACTION_MODELS_ENV,
  DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT,
  DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT_ENV,
  getDefaultModel,
  getDefaultCompactionModel,
  getDefaultCompactionModels,
  getDefaultCompactionSafetyMarginPercent,
};

/**
 * Resolve the default model string for tests, honoring the runtime env
 * override. Use this in shell templates so the same value flows to the
 * agent and to sibling tools like `opencode`.
 */
export function testDefaultModel() {
  return getDefaultModel();
}
