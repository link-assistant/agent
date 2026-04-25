//! Agent CLI library - A minimal, public domain AI CLI agent compatible with OpenCode's JSON interface
//!
//! This is the Rust implementation of the @link-assistant/agent CLI tool.
//! It provides the same functionality as the JavaScript/Bun version but runs as a native binary.

pub mod cli;
pub mod defaults;
pub mod error;
pub mod id;
pub mod tool;
pub mod util;
