//! Limit release writes to the selected package's metadata, preserving other work.
// An explicit entry point lets rust-script test this shared module directly.
#[cfg(test)]
fn main() {}

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

pub struct ReleaseIndex {
    repository: PathBuf,
    allowed: BTreeSet<PathBuf>,
}

fn git(repository: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let output = Command::new("git")
        .current_dir(repository)
        .args(args)
        .output()
        .map_err(|e| format!("Could not inspect release index: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "git {:?}: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(output.stdout)
}

fn paths(output: &[u8]) -> Result<Vec<PathBuf>, String> {
    output
        .split(|byte| *byte == 0)
        .filter(|p| !p.is_empty())
        .map(|bytes| {
            // Reject unrepresentable paths rather than changing or dropping them.
            String::from_utf8(bytes.to_vec())
                .map(PathBuf::from)
                .map_err(|_| "Release index contains a non-UTF-8 path".to_string())
        })
        .collect()
}

impl ReleaseIndex {
    pub fn new(rust_root: &Path, package_manifest: &Path) -> Result<Self, String> {
        let root = fs::canonicalize(rust_root).map_err(|e| e.to_string())?;
        let output = git(&root, &["rev-parse", "--show-toplevel"])?;
        // Match canonical root/manifest prefixes, including Windows verbatim paths.
        let repository =
            fs::canonicalize(String::from_utf8(output).map_err(|e| e.to_string())?.trim())
                .map_err(|e| e.to_string())?;
        let root_relative = root
            .strip_prefix(&repository)
            .map_err(|_| "Rust root is outside the repository")?;
        let manifest = fs::canonicalize(package_manifest).map_err(|e| e.to_string())?;
        let manifest_relative = manifest
            .strip_prefix(&repository)
            .map_err(|_| "Package manifest is outside the repository")?;
        let mut allowed = BTreeSet::from([manifest_relative.to_path_buf()]);
        for name in ["Cargo.lock", "CHANGELOG.md", "benchmarks/Cargo.lock"] {
            allowed.insert(root_relative.join(name));
        }
        let fragments = root.join("changelog.d");
        if fragments.exists() {
            for entry in fs::read_dir(&fragments).map_err(|e| e.to_string())? {
                let path = entry.map_err(|e| e.to_string())?.path();
                if path.is_file()
                    && path.extension().is_some_and(|ext| ext == "md")
                    && path.file_name().is_some_and(|name| name != "README.md")
                {
                    allowed.insert(
                        path.strip_prefix(&repository)
                            .map_err(|e| e.to_string())?
                            .to_path_buf(),
                    );
                }
            }
        }
        // Already deleted tracked fragments are absent from read_dir. They are
        // legitimate consumed metadata too; README and other files stay denied.
        let tracked = paths(&git(
            &repository,
            &["ls-tree", "-r", "--name-only", "-z", "HEAD"],
        )?)?;
        let fragment_prefix = root_relative.join("changelog.d");
        for path in tracked {
            if path.parent() == Some(fragment_prefix.as_path())
                && path.extension().is_some_and(|ext| ext == "md")
                && path.file_name().is_some_and(|name| name != "README.md")
            {
                allowed.insert(path);
            }
        }
        Ok(Self {
            repository,
            allowed,
        })
    }

    pub fn validate(&self) -> Result<(), String> {
        let modified = git(
            &self.repository,
            &[
                "ls-files",
                "--modified",
                "--deleted",
                "--others",
                "--exclude-standard",
                "-z",
            ],
        )?;
        let staged = git(
            &self.repository,
            &["diff", "--cached", "--name-only", "--no-renames", "-z"],
        )?;
        for path in paths(&modified)?.into_iter().chain(paths(&staged)?) {
            if !self.allowed.contains(&path) {
                return Err(format!("Refusing release: unrelated modified, untracked or staged path {:?}. Commit or move this work before releasing; no files were discarded.", path));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Fixture(PathBuf);
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn fixture(root: &str) -> Fixture {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let repo = Fixture(std::env::temp_dir().join(format!("release-index-{stamp}")));
        fs::create_dir_all(repo.0.join(root).join("changelog.d")).unwrap();
        git(&repo.0, &["init", "-q"]).unwrap();
        git(&repo.0, &["config", "user.name", "Test"]).unwrap();
        git(&repo.0, &["config", "user.email", "test@example.com"]).unwrap();
        fs::write(repo.0.join(root).join("Cargo.toml"), "version = '1.0.0'\n").unwrap();
        fs::write(repo.0.join(root).join("changelog.d/old.md"), "fragment\n").unwrap();
        fs::write(
            repo.0.join(root).join("changelog.d/README.md"),
            "instructions\n",
        )
        .unwrap();
        fs::write(repo.0.join("other-language.txt"), "keep\n").unwrap();
        git(&repo.0, &["add", "."]).unwrap();
        git(&repo.0, &["commit", "-qm", "base"]).unwrap();
        repo
    }
    fn index(repo: &Fixture, root: &str) -> ReleaseIndex {
        ReleaseIndex::new(&repo.0.join(root), &repo.0.join(root).join("Cargo.toml")).unwrap()
    }

    #[test]
    fn unrelated_staged_and_untracked_files_are_rejected_without_changes() {
        for root in ["", "rust", "rust root with spaces"] {
            let repo = fixture(root);
            let name = if cfg!(windows) {
                "unrelated file.txt"
            } else {
                "unrelated\nfile.txt"
            };
            fs::write(repo.0.join(name), "preserve\n").unwrap();
            assert!(index(&repo, root).validate().is_err());
            git(&repo.0, &["add", name]).unwrap();
            assert!(index(&repo, root).validate().is_err());
            assert_eq!(
                paths(&git(&repo.0, &["diff", "--cached", "--name-only", "-z"]).unwrap()).unwrap(),
                [PathBuf::from(name)]
            );
            assert_eq!(fs::read_to_string(repo.0.join(name)).unwrap(), "preserve\n");
        }
    }

    #[test]
    fn unstaged_other_language_changes_and_fragment_readme_are_rejected() {
        let repo = fixture("rust");
        fs::write(repo.0.join("other-language.txt"), "changed\n").unwrap();
        assert!(index(&repo, "rust").validate().is_err());
        git(&repo.0, &["checkout", "--", "other-language.txt"]).unwrap();
        fs::write(repo.0.join("rust/changelog.d/README.md"), "changed\n").unwrap();
        assert!(index(&repo, "rust").validate().is_err());
    }

    #[test]
    fn selected_workspace_manifest_locks_and_deleted_fragments_are_allowed() {
        let repo = fixture("rust");
        let root = repo.0.join("rust");
        fs::create_dir(root.join("member")).unwrap();
        fs::write(root.join("member/Cargo.toml"), "version='1.0.0'\n").unwrap();
        git(&repo.0, &["add", "."]).unwrap();
        git(&repo.0, &["commit", "-qm", "member"]).unwrap();
        let index = ReleaseIndex::new(&root, &root.join("member/Cargo.toml")).unwrap();
        fs::write(root.join("member/Cargo.toml"), "version='1.0.1'\n").unwrap();
        fs::create_dir(root.join("benchmarks")).unwrap();
        fs::write(root.join("benchmarks/Cargo.lock"), "lock\n").unwrap();
        fs::write(root.join("Cargo.lock"), "lock\n").unwrap();
        fs::write(root.join("CHANGELOG.md"), "release\n").unwrap();
        fs::remove_file(root.join("changelog.d/old.md")).unwrap();
        assert!(index.validate().is_ok());
        // Rebuilding the allowlist after a fragment was deleted also permits it.
        assert!(ReleaseIndex::new(&root, &root.join("member/Cargo.toml"))
            .unwrap()
            .validate()
            .is_ok());
        git(&repo.0, &["add", "-A"]).unwrap();
        assert!(index.validate().is_ok());
        git(&repo.0, &["commit", "-qm", "release"]).unwrap();
        let committed = paths(
            &git(
                &repo.0,
                &[
                    "diff-tree",
                    "--no-commit-id",
                    "--name-only",
                    "-r",
                    "-z",
                    "HEAD",
                ],
            )
            .unwrap(),
        )
        .unwrap();
        assert!(committed.iter().all(|path| index.allowed.contains(path)));
    }
}
