//! Rust counterpart of `js/tests/token.ts`.
//!
//! The JS test exercises a token estimation helper that wraps the
//! `gpt-tokenizer` package. The Rust port does not yet ship a tokenizer
//! and does not expose a token-counting function. When it does, this
//! file should mirror the JS test cases (chunk vs. message totals,
//! tokenizer cache, etc.).
//!
//! For now we verify a related surface: the centralized defaults expose
//! a non-zero context safety margin so the runtime always reserves
//! headroom for token slop.

use link_assistant_agent::cli::DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT;

#[test]
fn safety_margin_is_a_positive_percentage() {
    const _: () = assert!(DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT > 0);
    const _: () = assert!(DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT <= 100);
}

#[test]
fn safety_margin_matches_documented_default() {
    // The default was raised from 15% to 25% in #249 and #266 to reduce the
    // probability of context overflow when providers under-report tokens.
    assert_eq!(DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT, 25);
}
