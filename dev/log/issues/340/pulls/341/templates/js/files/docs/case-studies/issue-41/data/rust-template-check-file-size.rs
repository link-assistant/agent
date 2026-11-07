#!/usr/bin/env rust-script
//! Check for files exceeding the maximum allowed line count
//! Exits with error code 1 if any files exceed the limit
//!
//! Usage: rust-script scripts/check-file-size.rs
//!
//! ```cargo
//! [dependencies]
//! walkdir = "2"
//! ```

use std::fs;
use std::path::Path;
use std::process::exit;
use walkdir::WalkDir;

const MAX_LINES: usize = 1000;
const FILE_EXTENSIONS: &[&str] = &[".rs"];
const EXCLUDE_PATTERNS: &[&str] = &["target", ".git", "node_modules"];

fn should_exclude(path: &Path) -> bool {
    let path_str = path.to_string_lossy();
    EXCLUDE_PATTERNS.iter().any(|pattern| path_str.contains(pattern))
}

fn has_valid_extension(path: &Path) -> bool {
    if let Some(ext) = path.extension() {
        let ext_with_dot = format!(".{}", ext.to_string_lossy());
        FILE_EXTENSIONS.contains(&ext_with_dot.as_str())
    } else {
        false
    }
}

fn count_lines(path: &Path) -> Result<usize, std::io::Error> {
    let content = fs::read_to_string(path)?;
    Ok(content.lines().count())
}

struct Violation {
    file: String,
    lines: usize,
}

fn main() {
    println!("\nChecking Rust files for maximum {} lines...\n", MAX_LINES);

    let cwd = std::env::current_dir().expect("Failed to get current directory");
    let mut violations: Vec<Violation> = Vec::new();

    for entry in WalkDir::new(&cwd)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();

        if should_exclude(path) {
            continue;
        }

        if !has_valid_extension(path) {
            continue;
        }

        match count_lines(path) {
            Ok(line_count) => {
                if line_count > MAX_LINES {
                    let relative_path = path
                        .strip_prefix(&cwd)
                        .unwrap_or(path)
                        .to_string_lossy()
                        .to_string();
                    violations.push(Violation {
                        file: relative_path,
                        lines: line_count,
                    });
                }
            }
            Err(e) => {
                eprintln!("Warning: Could not read {}: {}", path.display(), e);
            }
        }
    }

    if violations.is_empty() {
        println!("All files are within the line limit\n");
        exit(0);
    } else {
        println!("Found files exceeding the line limit:\n");
        for violation in &violations {
            println!(
                "  {}: {} lines (exceeds {})",
                violation.file, violation.lines, MAX_LINES
            );
        }
        println!("\nPlease refactor these files to be under {} lines\n", MAX_LINES);
        exit(1);
    }
}
