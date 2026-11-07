#!/usr/bin/env rust-script
//! Guard release-producing binary crates against missing committed lockfiles.
//!
//! Binary crates should commit `Cargo.lock` so CI and releases resolve the same
//! dependency graph every time. This is especially important for workflows that
//! use cache keys based on `hashFiles('**/Cargo.lock')`: when no lockfile is
//! committed, that expression falls back to the same empty hash across runs.
//!
//! Supports both single-language and multi-language repository structures:
//! - Single-language: Cargo.toml in repository root
//! - Multi-language: Cargo.toml in rust/ subfolder
//!
//! Usage: rust-script scripts/check-cargo-lock.rs [--rust-root <path>]
//!
//! ```cargo
//! [dependencies]
//! regex = "1"
//! serde_json = "1"
//! ```

use std::path::{Path, PathBuf};
#[cfg(not(test))]
use std::process::{exit, Command};

use serde_json::Value;

#[cfg(not(test))]
#[path = "rust-paths.rs"]
mod rust_paths;

#[derive(Debug, PartialEq, Eq)]
enum CargoLockGuardResult {
    NotRequired,
    Satisfied,
    Missing,
    Uncommitted,
}

fn check_cargo_lock_requirement(
    package_has_installable_binary: bool,
    cargo_lock_path: &Path,
    cargo_lock_committed: bool,
) -> CargoLockGuardResult {
    if !package_has_installable_binary {
        return CargoLockGuardResult::NotRequired;
    }

    if !cargo_lock_path.exists() {
        return CargoLockGuardResult::Missing;
    }

    if !cargo_lock_committed {
        return CargoLockGuardResult::Uncommitted;
    }

    CargoLockGuardResult::Satisfied
}

fn package_has_installable_binary(
    metadata: &Value,
    package_manifest_path: &Path,
) -> Result<bool, String> {
    let packages = metadata
        .get("packages")
        .and_then(Value::as_array)
        .ok_or_else(|| "Cargo metadata did not contain a packages array".to_string())?;

    let package = packages
        .iter()
        .find(|package| {
            package
                .get("manifest_path")
                .and_then(Value::as_str)
                .is_some_and(|metadata_path| {
                    manifest_paths_match(metadata_path, package_manifest_path)
                })
        })
        .ok_or_else(|| {
            format!(
                "Cargo metadata did not include package manifest {}",
                package_manifest_path.display()
            )
        })?;

    let targets = package
        .get("targets")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            format!(
                "Cargo metadata package {} did not contain a targets array",
                package_manifest_path.display()
            )
        })?;

    Ok(targets.iter().any(target_is_binary))
}

fn target_is_binary(target: &Value) -> bool {
    target
        .get("kind")
        .and_then(Value::as_array)
        .is_some_and(|kinds| kinds.iter().any(|kind| kind.as_str() == Some("bin")))
}

fn manifest_paths_match(metadata_path: &str, package_manifest_path: &Path) -> bool {
    let metadata_path = Path::new(metadata_path);
    if metadata_path == package_manifest_path {
        return true;
    }

    match (
        metadata_path.canonicalize(),
        package_manifest_path.canonicalize(),
    ) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

#[cfg(not(test))]
fn cargo_metadata(package_manifest_path: &Path) -> Result<Value, String> {
    let output = Command::new("cargo")
        .args([
            "metadata",
            "--no-deps",
            "--format-version",
            "1",
            "--manifest-path",
        ])
        .arg(package_manifest_path)
        .output()
        .map_err(|e| format!("Failed to execute cargo metadata: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "cargo metadata failed for {}:\n{}",
            package_manifest_path.display(),
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse cargo metadata JSON: {e}"))
}

fn format_git_object_path(path: &Path, repository_root: Option<&Path>) -> Result<String, String> {
    let relative_path = if path.is_absolute() {
        let root = repository_root.ok_or_else(|| {
            format!(
                "Cannot convert absolute path {} to a git object path without the repository root",
                path.display()
            )
        })?;
        path.strip_prefix(root).map_err(|_| {
            format!(
                "Path {} is not inside git repository root {}",
                path.display(),
                root.display()
            )
        })?
    } else {
        path
    };

    Ok(relative_path
        .to_string_lossy()
        .replace('\\', "/")
        .strip_prefix("./")
        .map_or_else(
            || relative_path.to_string_lossy().replace('\\', "/"),
            ToString::to_string,
        ))
}

#[cfg(not(test))]
fn git_repository_root() -> Result<PathBuf, String> {
    let output = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .map_err(|e| format!("Failed to execute git rev-parse: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "git rev-parse --show-toplevel failed:\n{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(PathBuf::from(
        String::from_utf8_lossy(&output.stdout).trim(),
    ))
}

#[cfg(not(test))]
fn is_committed_to_head(path: &Path) -> Result<bool, String> {
    let repository_root = git_repository_root()?;
    let git_object = format!(
        "HEAD:{}",
        format_git_object_path(path, Some(&repository_root))?
    );
    let output = Command::new("git")
        .args(["cat-file", "-e", &git_object])
        .output()
        .map_err(|e| format!("Failed to execute git cat-file: {e}"))?;

    Ok(output.status.success())
}

#[cfg(not(test))]
fn main() {
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
    let cargo_lock = rust_paths::get_cargo_lock_path(&rust_root);
    let lock_committed = match is_committed_to_head(&cargo_lock) {
        Ok(committed) => committed,
        Err(e) => {
            eprintln!("Error: {e}");
            exit(1);
        }
    };

    println!("Package manifest: {}", package_manifest.display());
    println!("Cargo.lock path: {}", cargo_lock.display());

    let metadata = match cargo_metadata(&package_manifest) {
        Ok(metadata) => metadata,
        Err(e) => {
            eprintln!("Error: {e}");
            exit(1);
        }
    };
    let package_has_binary = match package_has_installable_binary(&metadata, &package_manifest) {
        Ok(has_binary) => has_binary,
        Err(e) => {
            eprintln!("Error: {e}");
            exit(1);
        }
    };

    match check_cargo_lock_requirement(package_has_binary, &cargo_lock, lock_committed) {
        CargoLockGuardResult::NotRequired => {
            println!("Cargo.lock guard skipped: package has no binary target");
            exit(0);
        }
        CargoLockGuardResult::Satisfied => {
            println!("Cargo.lock guard passed: binary package has a committed Cargo.lock");
            exit(0);
        }
        CargoLockGuardResult::Missing => {
            let message = format!(
                "Binary package {} requires a committed {}. Generate it with `cargo generate-lockfile` or `cargo check`, then commit it.",
                package_manifest.display(),
                cargo_lock.display()
            );
            println!("::error file={}::{message}", cargo_lock.display());
            eprintln!("\nERROR: {message}\n");
            exit(1);
        }
        CargoLockGuardResult::Uncommitted => {
            let message = format!(
                "Binary package {} has {}, but it is not committed at HEAD. Commit Cargo.lock so CI does not re-resolve an unpinned dependency graph.",
                package_manifest.display(),
                cargo_lock.display()
            );
            println!("::error file={}::{message}", cargo_lock.display());
            eprintln!("\nERROR: {message}\n");
            exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("check-cargo-lock-{name}-{nanos}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn cargo_metadata_binary_target_requires_committed_cargo_lock() {
        let metadata = serde_json::json!({
            "packages": [{
                "manifest_path": "/repo/Cargo.toml",
                "targets": [{
                    "kind": ["bin"],
                    "name": "demo-bin"
                }]
            }]
        });

        assert!(package_has_installable_binary(&metadata, Path::new("/repo/Cargo.toml")).unwrap());
    }

    #[test]
    fn generated_but_uncommitted_lockfile_fails_binary_package() {
        let repo = temp_dir("default-bin-uncommitted-lock");
        let src = repo.join("src");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("main.rs"), "fn main() {}\n").unwrap();
        let cargo_lock = repo.join("Cargo.lock");
        fs::write(&cargo_lock, "# generated lockfile\n").unwrap();

        let result = check_cargo_lock_requirement(true, &cargo_lock, false);
        assert_eq!(result, CargoLockGuardResult::Uncommitted);
    }

    #[test]
    fn committed_lockfile_satisfies_binary_package() {
        let repo = temp_dir("default-bin-committed-lock");
        let src = repo.join("src");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("main.rs"), "fn main() {}\n").unwrap();
        let cargo_lock = repo.join("Cargo.lock");
        fs::write(&cargo_lock, "# generated lockfile\n").unwrap();

        let result = check_cargo_lock_requirement(true, &cargo_lock, true);
        assert_eq!(result, CargoLockGuardResult::Satisfied);
    }

    #[test]
    fn library_only_package_does_not_require_cargo_lock() {
        let repo = temp_dir("library-only");

        let result = check_cargo_lock_requirement(false, &repo.join("Cargo.lock"), false);
        assert_eq!(result, CargoLockGuardResult::NotRequired);
    }

    #[test]
    fn cargo_metadata_library_target_does_not_require_cargo_lock() {
        let metadata = serde_json::json!({
            "packages": [{
                "manifest_path": "/repo/Cargo.toml",
                "targets": [{
                    "kind": ["lib"],
                    "name": "demo_lib"
                }]
            }]
        });

        assert!(!package_has_installable_binary(&metadata, Path::new("/repo/Cargo.toml")).unwrap());
    }

    #[test]
    fn cargo_metadata_requires_the_selected_package_manifest() {
        let metadata = serde_json::json!({
            "packages": [{
                "manifest_path": "/repo/other/Cargo.toml",
                "targets": [{
                    "kind": ["bin"],
                    "name": "other-bin"
                }]
            }]
        });

        let error =
            package_has_installable_binary(&metadata, Path::new("/repo/Cargo.toml")).unwrap_err();
        assert!(error.contains("Cargo metadata did not include package manifest"));
    }

    #[test]
    fn git_object_paths_are_relative_to_the_repository_root() {
        let repository_root = std::env::current_dir().unwrap().join("repo-root");
        let path = repository_root.join("rust").join("Cargo.lock");

        let git_path = format_git_object_path(&path, Some(&repository_root)).unwrap();

        assert_eq!(git_path, "rust/Cargo.lock");
    }

    #[test]
    fn relative_git_object_paths_drop_dot_prefix() {
        let git_path = format_git_object_path(Path::new("./Cargo.lock"), None).unwrap();

        assert_eq!(git_path, "Cargo.lock");
    }
}
