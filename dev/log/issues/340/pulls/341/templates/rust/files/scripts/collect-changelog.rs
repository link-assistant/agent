#!/usr/bin/env rust-script
//! Collect changelog fragments into CHANGELOG.md
//!
//! This script collects all .md files from changelog.d/ (except README.md)
//! and prepends them to CHANGELOG.md, then removes the processed fragments.
//!
//! Supports both single-language and multi-language repository structures:
//! - Single-language: Cargo.toml and changelog.d/ in repository root
//! - Multi-language: Cargo.toml and changelog.d/ in rust/ subfolder
//!
//! Usage: rust-script scripts/collect-changelog.rs [--rust-root <path>]
//!
//! ```cargo
//! [dependencies]
//! regex = "1"
//! chrono = "0.4"
//! ```

use chrono::Utc;
use regex::Regex;
use std::env;
use std::fs;
use std::path::Path;
use std::process::exit;

#[path = "changelog-files.rs"]
mod changelog_files;
use changelog_files::{list_fragments, path_error, read_file};

#[path = "release-content.rs"]
mod release_content;

const INSERT_MARKER: &str = "<!-- changelog-insert-here -->";

fn get_arg(name: &str) -> Option<String> {
    let args: Vec<String> = env::args().collect();
    let flag = format!("--{}", name);

    if let Some(idx) = args.iter().position(|a| a == &flag) {
        return args.get(idx + 1).cloned();
    }

    let env_name = name.to_uppercase().replace('-', "_");
    env::var(&env_name).ok().filter(|s| !s.is_empty())
}

fn get_rust_root() -> String {
    if let Some(root) = get_arg("rust-root") {
        eprintln!("Using explicitly configured Rust root: {}", root);
        return root;
    }

    if Path::new("./Cargo.toml").exists() {
        eprintln!("Detected single-language repository (Cargo.toml in root)");
        return ".".to_string();
    }

    if Path::new("./rust/Cargo.toml").exists() {
        eprintln!("Detected multi-language repository (Cargo.toml in rust/)");
        return "rust".to_string();
    }

    eprintln!("Error: Could not find Cargo.toml in expected locations");
    exit(1);
}

fn get_cargo_toml_path(rust_root: &str) -> String {
    if rust_root == "." {
        "./Cargo.toml".to_string()
    } else {
        format!("{}/Cargo.toml", rust_root)
    }
}

fn get_changelog_dir(rust_root: &str) -> String {
    if rust_root == "." {
        "./changelog.d".to_string()
    } else {
        format!("{}/changelog.d", rust_root)
    }
}

fn get_changelog_path(rust_root: &str) -> String {
    if rust_root == "." {
        "./CHANGELOG.md".to_string()
    } else {
        format!("{}/CHANGELOG.md", rust_root)
    }
}

fn get_version_from_cargo(cargo_toml_path: &str) -> Result<String, String> {
    let content = fs::read_to_string(cargo_toml_path)
        .map_err(|e| format!("Failed to read {}: {}", cargo_toml_path, e))?;

    let re = Regex::new(r#"(?m)^version\s*=\s*"([^"]+)""#).unwrap();

    if let Some(caps) = re.captures(&content) {
        Ok(caps.get(1).unwrap().as_str().to_string())
    } else {
        Err(format!("Could not find version in {}", cargo_toml_path))
    }
}

fn strip_frontmatter(content: &str) -> String {
    let re = Regex::new(r"(?s)^---\s*\n.*?\n---\s*\n(.*)$").unwrap();
    if let Some(caps) = re.captures(content) {
        caps.get(1).unwrap().as_str().trim().to_string()
    } else {
        content.trim().to_string()
    }
}

fn collect_fragments(changelog_dir: &str) -> std::io::Result<(String, Vec<std::path::PathBuf>)> {
    let files = list_fragments(Path::new(changelog_dir))?;
    let mut fragments = Vec::new();
    for file in &files {
        let raw_content = read_file(file)?;
        let content = strip_frontmatter(&raw_content);
        if !content.is_empty() {
            fragments.push(content);
        }
    }
    Ok((fragments.join("\n\n"), files))
}

fn update_changelog(changelog_file: &str, version: &str, fragments: &str) -> std::io::Result<()> {
    let date_str = Utc::now().format("%Y-%m-%d").to_string();
    let new_entry = format!("\n## [{}] - {}\n\n{}\n", version, date_str, fragments);

    if Path::new(changelog_file).exists() {
        let mut content = read_file(Path::new(changelog_file))?;

        if content.contains(INSERT_MARKER) {
            content = content.replace(INSERT_MARKER, &format!("{}{}", INSERT_MARKER, new_entry));
        } else {
            if let Some(heading) = release_content::release_headings(&content).first() {
                content.insert_str(heading.start, &new_entry);
            } else {
                content.push_str(&new_entry);
            }
        }

        fs::write(changelog_file, content)
            .map_err(|error| path_error("write changelog", Path::new(changelog_file), error))?;
    } else {
        let content = format!(
            "# Changelog\n\n\
            All notable changes to this project will be documented in this file.\n\n\
            The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),\n\
            and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).\n\n\
            {}\n{}\n",
            INSERT_MARKER, new_entry
        );
        fs::write(changelog_file, content)
            .map_err(|error| path_error("write changelog", Path::new(changelog_file), error))?;
    }

    println!("Updated CHANGELOG.md with version {}", version);
    Ok(())
}

fn remove_fragments(files: &[std::path::PathBuf]) -> std::io::Result<()> {
    for path in files {
        fs::remove_file(path).map_err(|error| path_error("remove fragment", path, error))?;
        println!("Removed {}", path.display());
    }
    Ok(())
}

fn main() -> std::io::Result<()> {
    let rust_root = get_rust_root();
    let cargo_toml = get_cargo_toml_path(&rust_root);
    let changelog_dir = get_changelog_dir(&rust_root);
    let changelog_file = get_changelog_path(&rust_root);

    let version = match get_version_from_cargo(&cargo_toml) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("Error: {}", e);
            exit(1);
        }
    };

    println!("Collecting changelog fragments for version {}", version);

    let (fragments, files) = collect_fragments(&changelog_dir)?;

    if fragments.is_empty() {
        println!("No changelog fragments found");
        exit(0);
    }

    update_changelog(&changelog_file, &version, &fragments)?;
    remove_fragments(&files)?;

    println!("Changelog collection complete");
    Ok(())
}

#[cfg(test)]
mod cleanup_tests {
    use super::remove_fragments;

    #[test]
    fn cleanup_must_report_deletion_failure() {
        let root = std::env::temp_dir().join(format!("fragment-removal-{}", std::process::id()));
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(root.join("fragment.md")).unwrap();
        let result = remove_fragments(&[root.join("fragment.md")]);
        std::fs::remove_dir_all(root).unwrap();
        let error = result.expect_err("fragment deletion must fail");
        assert!(error.to_string().contains("fragment.md"));
    }

    #[test]
    fn insertion_ignores_fenced_examples_and_preserves_existing_bytes() {
        let root = std::env::temp_dir().join(format!("collect-fenced-{}", std::process::id()));
        std::fs::create_dir(&root).unwrap();
        let changelog = root.join("CHANGELOG.md");
        let prefix = "# Changelog\r\n\r\n~~~md\r\n## [9.9.9]\r\n~~~\r\n\r\n";
        let previous = "## [1.0.0]\r\n  Preserve these bytes.\r\n";
        std::fs::write(&changelog, format!("{prefix}{previous}")).unwrap();
        super::update_changelog(
            changelog.to_str().unwrap(),
            "1.1.0",
            "### Fixed\n- New notes",
        )
        .unwrap();
        let content = std::fs::read_to_string(&changelog).unwrap();
        assert!(content.starts_with(prefix));
        assert!(content.ends_with(previous));
        assert!(super::release_content::release_notes(&content, "1.1.0")
            .unwrap()
            .contains("New notes"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
