//! Identifier generation utilities
//!
//! This module provides monotonic, time-ordered unique identifiers that match
//! the JavaScript implementation's Identifier module. IDs can be generated
//! in ascending or descending order for different use cases.

use rand::Rng;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Prefix types for different entity identifiers
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Prefix {
    Session,
    Message,
    Permission,
    User,
    Part,
}

impl Prefix {
    /// Get the string prefix for this identifier type
    pub fn as_str(&self) -> &'static str {
        match self {
            Prefix::Session => "ses",
            Prefix::Message => "msg",
            Prefix::Permission => "per",
            Prefix::User => "usr",
            Prefix::Part => "prt",
        }
    }
}

// State for monotonic ID generation
static LAST_TIMESTAMP: AtomicU64 = AtomicU64::new(0);
static COUNTER: AtomicU32 = AtomicU32::new(0);

/// ID length (excluding prefix and underscore)
const ID_LENGTH: usize = 26;

/// Generate a random base62 string of the given length
fn random_base62(length: usize) -> String {
    const CHARS: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let mut rng = rand::thread_rng();
    (0..length)
        .map(|_| {
            let idx = rng.gen_range(0..62);
            CHARS[idx] as char
        })
        .collect()
}

/// Get current timestamp in milliseconds
fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("Time went backwards")
        .as_millis() as u64
}

/// Create a new unique identifier with the given prefix
///
/// # Arguments
/// * `prefix` - The prefix type for this identifier
/// * `descending` - If true, creates descending IDs (for reverse chronological sorting)
/// * `timestamp` - Optional timestamp to use (defaults to current time)
pub fn create(prefix: Prefix, descending: bool, timestamp: Option<u64>) -> String {
    let current_timestamp = timestamp.unwrap_or_else(current_timestamp_ms);

    // Update counter atomically
    let last = LAST_TIMESTAMP.load(Ordering::SeqCst);
    let counter = if current_timestamp != last {
        LAST_TIMESTAMP.store(current_timestamp, Ordering::SeqCst);
        COUNTER.store(1, Ordering::SeqCst);
        1
    } else {
        COUNTER.fetch_add(1, Ordering::SeqCst) + 1
    };

    // Combine timestamp and counter
    let mut now = (current_timestamp as u128) * 0x1000 + (counter as u128);

    // Invert for descending order
    if descending {
        now = !now;
    }

    // Extract 6 bytes for the time component
    let mut time_bytes = [0u8; 6];
    for i in 0..6 {
        time_bytes[i] = ((now >> (40 - 8 * i)) & 0xff) as u8;
    }

    // Build the ID: prefix_timeHex + random
    let time_hex: String = time_bytes.iter().map(|b| format!("{b:02x}")).collect();
    let random_part = random_base62(ID_LENGTH - 12);

    format!("{}_{}{}", prefix.as_str(), time_hex, random_part)
}

/// Generate an ascending (chronologically ordered) identifier
pub fn ascending(prefix: Prefix, given: Option<&str>) -> String {
    match given {
        Some(id) => {
            let expected_prefix = prefix.as_str();
            if !id.starts_with(expected_prefix) {
                panic!("ID {} does not start with {}", id, expected_prefix);
            }
            id.to_string()
        }
        None => create(prefix, false, None),
    }
}

/// Generate a descending (reverse chronologically ordered) identifier
pub fn descending(prefix: Prefix, given: Option<&str>) -> String {
    match given {
        Some(id) => {
            let expected_prefix = prefix.as_str();
            if !id.starts_with(expected_prefix) {
                panic!("ID {} does not start with {}", id, expected_prefix);
            }
            id.to_string()
        }
        None => create(prefix, true, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
