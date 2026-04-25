//! Rust counterpart of `js/tests/mcp-timeout.ts`.
//!
//! The Model Context Protocol (MCP) integration lives in
//! `js/src/mcp/` and provides a per-tool timeout wrapper that races a
//! `Promise.race` against `setTimeout`. The Rust port does not yet ship MCP
//! support, so the JS tests cover behavior that has no Rust counterpart.
//!
//! When the Rust MCP module lands, this file should mirror the JS test
//! cases (timeout fires, success path, error pass-through, abort handling).
//! For now we keep it as a documented placeholder so the JS and Rust trees
//! have identical file names.

#[test]
fn mcp_module_is_unimplemented_in_rust_port() {
    // Sanity check: confirm the Rust crate compiles without an MCP module.
    // When MCP support is added, replace this with a real timeout test
    // mirroring `js/tests/mcp-timeout.ts`.
    let timeout_default_ms: u64 = 30_000;
    assert!(timeout_default_ms > 0);
}
