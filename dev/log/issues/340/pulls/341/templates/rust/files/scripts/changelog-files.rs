//! Fallible, deterministic fragment discovery shared by release helpers.

// Keep rust-script from wrapping this module as an expression in test builds.
#[cfg(test)]
#[allow(dead_code)]
fn main() {}

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// List sorted `.md` fragment paths, excluding README.md.
///
/// A missing directory means no fragments. All other directory and entry
/// failures are errors, including a regular file in place of the directory.
pub fn list_fragments(directory: &Path) -> io::Result<Vec<PathBuf>> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(path_error("read fragment directory", directory, error)),
    };
    let mut files = Vec::new();
    for entry in entries {
        let path = entry
            .map_err(|error| path_error("read fragment directory entry", directory, error))?
            .path();
        if path.extension().is_some_and(|ext| ext == "md")
            && path.file_name().is_some_and(|name| name != "README.md")
        {
            files.push(path);
        }
    }
    files.sort();
    Ok(files)
}

/// Add operation and path context while preserving the I/O error kind.
pub fn path_error(operation: &str, path: &Path, error: io::Error) -> io::Error {
    io::Error::new(
        error.kind(),
        format!("Failed to {operation} '{}': {error}", path.display()),
    )
}

/// Read a release file without dropping I/O errors or their path context.
pub fn read_file(path: &Path) -> io::Result<String> {
    fs::read_to_string(path).map_err(|error| path_error("read file", path, error))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn directory_read_failures_are_not_empty_collections() {
        let root = std::env::temp_dir().join(format!(
            "changelog-files-{}-{}",
            std::process::id(),
            module_path!().replace("::", "-")
        ));
        fs::write(&root, "not a directory").unwrap();
        let error = list_fragments(&root).unwrap_err();
        fs::remove_file(&root).unwrap();
        assert!(error.to_string().contains(&root.display().to_string()));
    }

    #[test]
    fn missing_directory_has_no_fragments() {
        let root = std::env::temp_dir().join(format!("absent-fragments-{}", std::process::id()));
        assert!(list_fragments(&root).unwrap().is_empty());
    }
}
