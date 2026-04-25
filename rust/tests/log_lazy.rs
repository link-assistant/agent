//! Rust counterpart of `js/tests/log-lazy.js`.
//!
//! The JavaScript implementation uses a custom lazy-logger built on top of
//! `log-lazy` (`js/src/util/log.ts`, `js/src/util/log-lazy.ts`) that allows
//! deferring expensive log payload construction until the relevant level is
//! enabled. The Rust port instead uses the `tracing` ecosystem, which
//! provides the same lazy-evaluation guarantees through the `tracing::event!`
//! macros and feature filters.
//!
//! There is no Rust equivalent of `Log.create()` or `createLazyLogger()`, so
//! these tests confirm the `tracing` crate surface that the Rust code relies
//! on for the same behavior. If we ever rewrite the runtime logger, this
//! file is the place to mirror the JS unit tests directly.

use tracing::Level;

#[test]
fn tracing_levels_are_ordered() {
    // tracing orders levels from most-severe (low value) to least-severe
    // (high value). The same lazy-evaluation guarantee the JS log-lazy
    // module documents holds for any disabled level.
    assert!(Level::ERROR < Level::WARN);
    assert!(Level::WARN < Level::INFO);
    assert!(Level::INFO < Level::DEBUG);
    assert!(Level::DEBUG < Level::TRACE);
}

#[test]
fn tracing_level_strings_match_lazy_logger_levels() {
    // The JS lazy logger exposes "error", "warn", "info", "debug", "verbose",
    // "trace" levels. tracing covers ERROR/WARN/INFO/DEBUG/TRACE; "verbose"
    // is mapped to TRACE in the runtime.
    assert_eq!(Level::ERROR.to_string(), "ERROR");
    assert_eq!(Level::WARN.to_string(), "WARN");
    assert_eq!(Level::INFO.to_string(), "INFO");
    assert_eq!(Level::DEBUG.to_string(), "DEBUG");
    assert_eq!(Level::TRACE.to_string(), "TRACE");
}

#[test]
fn tracing_macros_compile_with_lazy_payload() {
    // tracing::event! discards the payload when the level is disabled, which
    // is the same lazy semantics the JS log-lazy module documents.
    tracing::trace!(payload = "discarded when TRACE is disabled");
}
