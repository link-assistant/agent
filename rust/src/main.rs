//! Agent CLI - A minimal, public domain AI CLI agent compatible with OpenCode's JSON interface
//!
//! This is the Rust implementation of the @link-assistant/agent CLI tool.
//! It provides the same functionality as the JavaScript/Bun version but runs as a native binary.

mod cli;
mod error;
mod id;
mod tool;
mod util;

use clap::Parser;
use cli::Args;
use error::Result;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::registry()
        .with(fmt::layer().json())
        .with(filter)
        .init();

    // Parse command line arguments
    let args = Args::parse();

    // Run the CLI
    cli::run(args).await
}
