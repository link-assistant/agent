//! Utility modules for the Agent CLI
//!
//! This module contains various utility functions and types used throughout
//! the agent implementation, mirroring the js/src/util/ directory structure.

pub mod filesystem;
pub mod binary;

pub use filesystem::Filesystem;
pub use binary::is_binary_file;
