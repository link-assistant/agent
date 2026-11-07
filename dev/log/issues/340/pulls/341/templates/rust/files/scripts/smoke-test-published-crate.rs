#!/usr/bin/env rust-script
//! Install-from-package smoke test for a published crates.io artifact.
//!
//! This script proves that the freshly published crate is usable by downstream
//! consumers, not just visible in the crates.io index:
//! - installs advertised binary targets with `cargo install` into a temp root
//! - runs each installed binary with `--help`
//! - compiles a fresh dependent crate that imports the published library target
//!
//! CLI output is captured before previewing a few lines, so the smoke test never
//! pipes a live Rust process into a short reader such as `head` under `pipefail`.
//!
//! Usage:
//!   rust-script scripts/smoke-test-published-crate.rs --release-version <version>
//!
//! Optional arguments:
//!   --crate-name <name>       Crate name. Defaults to Cargo.toml package name.
//!   --rust-root <path>        Root containing Cargo.toml. Defaults to auto-detect.
//!   --max-attempts <count>    Defaults to 5.
//!   --sleep-seconds <count>   Defaults to 10.
//!
//! Outputs (written to GITHUB_OUTPUT):
//!   - smoke_test: 'pass', or 'skipped' for template defaults
//!
//! ```cargo
//! [dependencies]
//! regex = "1"
//! ```

use regex::Regex;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{exit, Command, Output};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[path = "rust-paths.rs"]
mod rust_paths;

const TEMPLATE_DEFAULT_CRATE: &str = "example-sum-package-name";
const DEFAULT_MAX_ATTEMPTS: u64 = 5;
const DEFAULT_SLEEP_SECONDS: u64 = 10;
const CLI_PREVIEW_LINES: usize = 20;

#[derive(Debug, Clone, PartialEq, Eq)]
struct EntryPoints {
    crate_name: String,
    version: String,
    lib_name: Option<String>,
    bin_names: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ManifestSection {
    Lib,
    Bin,
    Other,
}

fn get_arg(name: &str) -> Option<String> {
    let args: Vec<String> = env::args().collect();
    let flag = format!("--{name}");

    if let Some(idx) = args.iter().position(|a| a == &flag) {
        return args.get(idx + 1).cloned();
    }

    let env_name = name.to_uppercase().replace('-', "_");
    env::var(&env_name).ok().filter(|s| !s.is_empty())
}

fn parse_count_arg(name: &str, default: u64) -> u64 {
    get_arg(name)
        .and_then(|value| {
            value.parse::<u64>().map_or_else(
                |_| {
                    eprintln!("Warning: Invalid {name} value '{value}'; using default {default}");
                    None
                },
                Some,
            )
        })
        .unwrap_or(default)
}

#[path = "github-output.rs"]
mod github_output;

fn set_output(key: &str, value: &str) -> std::io::Result<()> {
    github_output::write_output(key, value)?;
    println!("Output: {key}={value}");
    Ok(())
}

fn should_skip_smoke_test(crate_name: &str) -> bool {
    crate_name == TEMPLATE_DEFAULT_CRATE
}

fn default_lib_name(package_name: &str) -> String {
    package_name.replace('-', "_")
}

fn manifest_value(line: &str, key: &str) -> Option<String> {
    let re = Regex::new(&format!(r#"^\s*{}\s*=\s*"([^"]+)""#, regex::escape(key))).unwrap();
    re.captures(line)
        .and_then(|caps| caps.get(1).map(|value| value.as_str().to_string()))
}

fn detect_entrypoints(
    manifest_path: &Path,
    manifest_content: &str,
    crate_name: String,
    version: String,
) -> EntryPoints {
    let manifest_dir = manifest_path.parent().unwrap_or_else(|| Path::new("."));
    let mut section = ManifestSection::Other;
    let mut explicit_lib_name = None;
    let mut bin_names = Vec::new();

    for line in manifest_content.lines() {
        let trimmed = line.trim();

        if trimmed == "[lib]" {
            section = ManifestSection::Lib;
            continue;
        }
        if trimmed == "[[bin]]" {
            section = ManifestSection::Bin;
            continue;
        }
        if trimmed.starts_with('[') {
            section = ManifestSection::Other;
            continue;
        }

        let Some(name) = manifest_value(line, "name") else {
            continue;
        };
        match section {
            ManifestSection::Lib => explicit_lib_name = Some(name),
            ManifestSection::Bin => bin_names.push(name),
            ManifestSection::Other => {}
        }
    }

    let has_library = explicit_lib_name.is_some() || manifest_dir.join("src/lib.rs").exists();
    let lib_name =
        has_library.then(|| explicit_lib_name.unwrap_or_else(|| default_lib_name(&crate_name)));

    if bin_names.is_empty() && manifest_dir.join("src/main.rs").exists() {
        bin_names.push(crate_name.clone());
    }

    EntryPoints {
        crate_name,
        version,
        lib_name,
        bin_names,
    }
}

fn read_entrypoints(
    package_manifest: &Path,
    crate_name_override: Option<String>,
) -> Result<EntryPoints, String> {
    let package_info = rust_paths::read_package_info(package_manifest)?;
    let manifest_content = fs::read_to_string(package_manifest)
        .map_err(|e| format!("Failed to read {}: {e}", package_manifest.display()))?;
    let crate_name = crate_name_override.unwrap_or(package_info.name);
    let version = get_arg("release-version").unwrap_or(package_info.version);

    Ok(detect_entrypoints(
        package_manifest,
        &manifest_content,
        crate_name,
        version,
    ))
}

fn output_text(output: &Output) -> String {
    let mut text = String::new();
    text.push_str(&String::from_utf8_lossy(&output.stdout));
    if !output.stderr.is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    text
}

fn preview_lines(text: &str, max_lines: usize) -> String {
    text.lines().take(max_lines).collect::<Vec<_>>().join("\n")
}

fn run_status(command: &mut Command, label: &str) -> Result<(), String> {
    println!("Running: {command:?}");
    let status = command
        .status()
        .map_err(|e| format!("Failed to start {label}: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("{label} failed with status {status}"))
    }
}

fn retry<F>(
    label: &str,
    max_attempts: u64,
    sleep_seconds: u64,
    mut attempt: F,
) -> Result<(), String>
where
    F: FnMut() -> Result<(), String>,
{
    for attempt_number in 1..=max_attempts {
        println!("{label} (attempt {attempt_number}/{max_attempts})");
        match attempt() {
            Ok(()) => return Ok(()),
            Err(e) if attempt_number < max_attempts => {
                eprintln!("{label} failed: {e}");
                eprintln!("Waiting {sleep_seconds}s before retrying...");
                thread::sleep(Duration::from_secs(sleep_seconds));
            }
            Err(e) => return Err(format!("{label} failed after {max_attempts} attempts: {e}")),
        }
    }

    unreachable!("retry loop always returns");
}

fn make_temp_dir(crate_name: &str) -> Result<PathBuf, String> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("System clock is before UNIX_EPOCH: {e}"))?
        .as_nanos();
    let dir = env::temp_dir().join(format!("published-crate-smoke-{crate_name}-{nanos}"));
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    Ok(dir)
}

fn install_binaries(
    entrypoints: &EntryPoints,
    work_dir: &Path,
    max_attempts: u64,
    sleep_seconds: u64,
) -> Result<Option<PathBuf>, String> {
    if entrypoints.bin_names.is_empty() {
        println!("No binary targets detected; skipping cargo install smoke test");
        return Ok(None);
    }

    let install_root = work_dir.join("install");
    let exact_version = format!("={}", entrypoints.version);
    let label = format!(
        "Install {}@{} from crates.io",
        entrypoints.crate_name, entrypoints.version
    );

    retry(&label, max_attempts, sleep_seconds, || {
        let mut command = Command::new("cargo");
        command
            .arg("install")
            .arg(&entrypoints.crate_name)
            .arg("--version")
            .arg(&exact_version)
            .arg("--root")
            .arg(&install_root)
            .arg("--locked");
        run_status(&mut command, &label)
    })?;

    Ok(Some(install_root))
}

fn installed_binary_path(install_root: &Path, bin_name: &str) -> PathBuf {
    install_root
        .join("bin")
        .join(format!("{bin_name}{}", env::consts::EXE_SUFFIX))
}

fn check_cli_entrypoints(
    entrypoints: &EntryPoints,
    install_root: Option<&Path>,
) -> Result<(), String> {
    let Some(install_root) = install_root else {
        return Ok(());
    };

    for bin_name in &entrypoints.bin_names {
        let bin_path = installed_binary_path(install_root, bin_name);
        if !bin_path.exists() {
            return Err(format!(
                "Expected installed binary {} was not found",
                bin_path.display()
            ));
        }

        println!("Checking CLI entry point: {} --help", bin_path.display());
        let output = Command::new(&bin_path)
            .arg("--help")
            .output()
            .map_err(|e| format!("Failed to run {} --help: {e}", bin_path.display()))?;
        let combined = output_text(&output);

        if !output.status.success() {
            return Err(format!(
                "{} --help failed with status {}\n{}",
                bin_path.display(),
                output.status,
                combined.trim()
            ));
        }
        if combined.trim().is_empty() {
            return Err(format!("{} --help produced no output", bin_path.display()));
        }

        println!("CLI OK: {bin_name} --help produced output");
        println!("{}", preview_lines(&combined, CLI_PREVIEW_LINES));
    }

    Ok(())
}

fn toml_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn library_consumer_manifest(lib_name: &str, crate_name: &str, version: &str) -> String {
    format!(
        r#"[package]
name = "published-crate-smoke-test"
version = "0.0.0"
edition = "2021"
publish = false

[dependencies]
"{}" = {{ package = "{}", version = "={}" }}
"#,
        toml_string(lib_name),
        toml_string(crate_name),
        toml_string(version)
    )
}

fn library_consumer_main(lib_name: &str) -> String {
    format!(
        r#"extern crate {lib_name};

fn main() {{
    println!("library OK: {lib_name} is importable");
}}
"#
    )
}

fn check_library_entrypoint(
    entrypoints: &EntryPoints,
    work_dir: &Path,
    max_attempts: u64,
    sleep_seconds: u64,
) -> Result<(), String> {
    let Some(lib_name) = &entrypoints.lib_name else {
        println!("No library target detected; skipping dependent-crate smoke test");
        return Ok(());
    };

    println!("Checking library entry point: dependent crate imports {lib_name}");
    let consumer_dir = work_dir.join("lib-consumer");
    let src_dir = consumer_dir.join("src");
    fs::create_dir_all(&src_dir)
        .map_err(|e| format!("Failed to create {}: {e}", src_dir.display()))?;
    fs::write(
        consumer_dir.join("Cargo.toml"),
        library_consumer_manifest(lib_name, &entrypoints.crate_name, &entrypoints.version),
    )
    .map_err(|e| format!("Failed to write dependent Cargo.toml: {e}"))?;
    fs::write(src_dir.join("main.rs"), library_consumer_main(lib_name))
        .map_err(|e| format!("Failed to write dependent main.rs: {e}"))?;

    let label = format!(
        "Compile dependent crate against {}@{}",
        entrypoints.crate_name, entrypoints.version
    );
    retry(&label, max_attempts, sleep_seconds, || {
        let mut command = Command::new("cargo");
        command.arg("run").arg("--quiet").current_dir(&consumer_dir);
        run_status(&mut command, &label)
    })
}

fn run_smoke_test(
    entrypoints: &EntryPoints,
    max_attempts: u64,
    sleep_seconds: u64,
) -> Result<(), String> {
    println!(
        "Smoke-testing published crate {}@{}",
        entrypoints.crate_name, entrypoints.version
    );
    println!(
        "Detected entry points: library={:?}, binaries={:?}",
        entrypoints.lib_name, entrypoints.bin_names
    );

    let work_dir = make_temp_dir(&entrypoints.crate_name)?;
    println!("Workspace: {}", work_dir.display());

    let result = (|| {
        let install_root = install_binaries(entrypoints, &work_dir, max_attempts, sleep_seconds)?;
        check_cli_entrypoints(entrypoints, install_root.as_deref())?;
        check_library_entrypoint(entrypoints, &work_dir, max_attempts, sleep_seconds)
    })();

    if let Err(e) = fs::remove_dir_all(&work_dir) {
        eprintln!("Warning: Could not remove {}: {e}", work_dir.display());
    }

    result
}

fn main() -> std::io::Result<()> {
    let rust_root = match rust_paths::get_rust_root(None, true) {
        Ok(root) => root,
        Err(e) => {
            eprintln!("Error: {e}");
            exit(1);
        }
    };
    let cargo_toml = rust_paths::get_cargo_toml_path(&rust_root);
    let package_manifest = match rust_paths::get_package_manifest_path(&cargo_toml) {
        Ok(path) => path,
        Err(e) => {
            eprintln!("Error: {e}");
            exit(1);
        }
    };
    let crate_name_override = get_arg("crate-name");
    let max_attempts = parse_count_arg("max-attempts", DEFAULT_MAX_ATTEMPTS);
    let sleep_seconds = parse_count_arg("sleep-seconds", DEFAULT_SLEEP_SECONDS);

    let entrypoints = match read_entrypoints(&package_manifest, crate_name_override) {
        Ok(entrypoints) => entrypoints,
        Err(e) => {
            eprintln!("Error: {e}");
            exit(1);
        }
    };

    if should_skip_smoke_test(&entrypoints.crate_name) {
        println!(
            "Skipping published-crate smoke test: package name is the template default '{}'",
            entrypoints.crate_name
        );
        set_output("smoke_test", "skipped")?;
        return Ok(());
    }

    if let Err(e) = run_smoke_test(&entrypoints, max_attempts, sleep_seconds) {
        eprintln!("::error::Published crate smoke test failed: {e}");
        set_output("smoke_test", "fail")?;
        exit(1);
    }

    println!(
        "Published crate smoke test passed for {}@{}",
        entrypoints.crate_name, entrypoints.version
    );
    set_output("smoke_test", "pass")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_manifest_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = env::temp_dir().join(format!("{name}-{nanos}"));
        fs::create_dir_all(dir.join("src")).unwrap();
        dir
    }

    #[test]
    fn detects_default_library_and_binary_targets() {
        let dir = temp_manifest_dir("smoke-default-targets");
        fs::write(dir.join("src/lib.rs"), "").unwrap();
        fs::write(dir.join("src/main.rs"), "").unwrap();
        let manifest = dir.join("Cargo.toml");
        fs::write(
            &manifest,
            r#"[package]
name = "demo-crate"
version = "1.2.3"
edition = "2021"
"#,
        )
        .unwrap();

        let entrypoints = detect_entrypoints(
            &manifest,
            &fs::read_to_string(&manifest).unwrap(),
            "demo-crate".to_string(),
            "1.2.3".to_string(),
        );

        assert_eq!(entrypoints.lib_name.as_deref(), Some("demo_crate"));
        assert_eq!(entrypoints.bin_names, vec!["demo-crate"]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn detects_explicit_library_and_binary_target_names() {
        let dir = temp_manifest_dir("smoke-explicit-targets");
        let manifest = dir.join("Cargo.toml");
        let content = r#"[package]
name = "published-name"
version = "0.5.0"
edition = "2021"

[lib]
name = "import_name"
path = "src/lib.rs"

[[bin]]
name = "first-cli"
path = "src/main.rs"

[[bin]]
name = "second-cli"
path = "src/second.rs"
"#;
        fs::write(&manifest, content).unwrap();

        let entrypoints = detect_entrypoints(
            &manifest,
            content,
            "published-name".to_string(),
            "0.5.0".to_string(),
        );

        assert_eq!(entrypoints.lib_name.as_deref(), Some("import_name"));
        assert_eq!(entrypoints.bin_names, vec!["first-cli", "second-cli"]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn library_consumer_uses_exact_published_package_version() {
        let manifest = library_consumer_manifest("import_name", "published-name", "2.0.1");

        assert!(manifest
            .contains(r#""import_name" = { package = "published-name", version = "=2.0.1" }"#));
    }

    #[test]
    fn cli_preview_is_taken_from_captured_output() {
        let output = "line 1\nline 2\nline 3\n";

        assert_eq!(preview_lines(output, 2), "line 1\nline 2");
    }

    #[test]
    fn skips_template_default_package_name() {
        assert!(should_skip_smoke_test("example-sum-package-name"));
        assert!(!should_skip_smoke_test("real-crate"));
    }
}
