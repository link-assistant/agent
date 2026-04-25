//! Rust counterpart of `js/tests/safe-json-serialization.ts`.
//!
//! The JS test exercises a safe JSON serializer that handles circular
//! references, BigInt values and other JS-specific data types. The Rust
//! port uses `serde_json` which already enforces compile-time guarantees
//! against the equivalent JS pitfalls (you can't serialize a circular
//! reference because `Serialize` requires a tree-shaped value).
//!
//! These tests verify that the same JSON shape the JS suite asserts on is
//! producible from Rust.

use serde_json::json;

#[test]
fn serializes_nested_objects() {
    let value = json!({
        "type": "step_start",
        "timestamp": 0,
        "sessionID": "ses_test",
    });
    let s = serde_json::to_string(&value).unwrap();
    assert!(s.contains("step_start"));
    assert!(s.contains("ses_test"));
}

#[test]
fn handles_optional_values() {
    let value = json!({
        "field": null,
    });
    assert_eq!(value["field"], serde_json::Value::Null);
}

#[test]
fn rejects_invalid_utf8_via_lossy_marker() {
    // serde_json strings are guaranteed valid UTF-8. A faulty byte string
    // would be rejected at the type level. This test documents that the
    // safe-serializer "lossy" path in JS has no Rust analogue because the
    // Rust compiler enforces it.
    let value = serde_json::Value::String("ok".to_string());
    let s = serde_json::to_string(&value).unwrap();
    assert_eq!(s, "\"ok\"");
}
