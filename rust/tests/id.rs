//! Tests for the ID generation module.
//!
//! Extracted from the original inline tests in rust/src/id.rs.

use agent::id::{ascending, descending, Prefix};

#[test]
fn test_prefix_strings() {
    assert_eq!(Prefix::Session.as_str(), "ses");
    assert_eq!(Prefix::Message.as_str(), "msg");
    assert_eq!(Prefix::Permission.as_str(), "per");
    assert_eq!(Prefix::User.as_str(), "usr");
    assert_eq!(Prefix::Part.as_str(), "prt");
}

#[test]
fn test_create_ascending() {
    let id1 = ascending(Prefix::Session, None);
    let id2 = ascending(Prefix::Session, None);

    assert!(id1.starts_with("ses_"));
    assert!(id2.starts_with("ses_"));
    assert_ne!(id1, id2);
    // Ascending IDs should sort ascending by time
    assert!(id1 < id2);
}

#[test]
fn test_create_descending() {
    let id1 = descending(Prefix::Message, None);
    let id2 = descending(Prefix::Message, None);

    assert!(id1.starts_with("msg_"));
    assert!(id2.starts_with("msg_"));
    assert_ne!(id1, id2);
    // Descending IDs should sort descending by time
    assert!(id1 > id2);
}

#[test]
fn test_id_length() {
    let id = ascending(Prefix::Part, None);
    // Format: prefix_timeHex(12 chars) + random(14 chars) = 4 + 1 + 26 = 31
    assert_eq!(id.len(), 4 + 26); // "prt_" + 26 chars
}

#[test]
fn test_given_id_passthrough() {
    let given = "ses_abc123def456";
    let id = ascending(Prefix::Session, Some(given));
    assert_eq!(id, given);
}

#[test]
#[should_panic(expected = "does not start with")]
fn test_given_id_wrong_prefix() {
    ascending(Prefix::Session, Some("msg_wrong_prefix"));
}

// --- Additional tests for ID format consistency with JS ---

#[test]
fn test_call_id_prefix() {
    let id = ascending(Prefix::Call, None);
    assert!(id.starts_with("call_"));
}

#[test]
fn test_ids_are_unique() {
    let mut ids = Vec::new();
    for _ in 0..100 {
        ids.push(ascending(Prefix::Session, None));
    }
    // All IDs should be unique
    let unique: std::collections::HashSet<&String> = ids.iter().collect();
    assert_eq!(unique.len(), 100);
}
