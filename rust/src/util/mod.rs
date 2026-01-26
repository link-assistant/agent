//! Utility modules for the Agent CLI
//!
//! This module contains various utility functions and types used throughout
//! the agent implementation, mirroring the js/src/util/ directory structure.

pub mod binary;
pub mod filesystem;

pub use binary::is_binary_file;
pub use filesystem::Filesystem;
