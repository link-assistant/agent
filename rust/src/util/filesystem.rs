//! Filesystem utilities
//!
//! Provides path manipulation and file discovery utilities that mirror
//! the JavaScript implementation's Filesystem namespace.

use std::path::{Path, PathBuf};
use tokio::fs;

/// Filesystem utilities namespace
pub struct Filesystem;

impl Filesystem {
    /// Check if two paths overlap (one contains or is contained by the other)
    ///
    /// # Examples
    /// ```
    /// use link_assistant_agent::util::Filesystem;
    ///
    /// assert!(Filesystem::overlaps("/home/user", "/home/user/docs"));
    /// assert!(Filesystem::overlaps("/home/user/docs", "/home/user"));
    /// assert!(!Filesystem::overlaps("/home/user", "/var/log"));
    /// ```
    pub fn overlaps(a: impl AsRef<Path>, b: impl AsRef<Path>) -> bool {
        let a = a.as_ref();
        let b = b.as_ref();

        // Calculate relative paths both ways
        if let Ok(rel_a) = pathdiff::diff_paths(b, a) {
            if !rel_a.starts_with("..") {
                return true;
            }
        }
        if let Ok(rel_b) = pathdiff::diff_paths(a, b) {
            if !rel_b.starts_with("..") {
                return true;
            }
        }

        // Check if paths are the same or related
        Self::contains(a, b) || Self::contains(b, a)
    }

    /// Check if parent path contains the child path
    ///
    /// # Examples
    /// ```
    /// use link_assistant_agent::util::Filesystem;
    ///
    /// assert!(Filesystem::contains("/home/user", "/home/user/docs"));
    /// assert!(!Filesystem::contains("/home/user/docs", "/home/user"));
    /// ```
    pub fn contains(parent: impl AsRef<Path>, child: impl AsRef<Path>) -> bool {
        let parent = parent.as_ref();
        let child = child.as_ref();

        // Normalize paths and check if child starts with parent
        if let (Ok(p), Ok(c)) = (parent.canonicalize(), child.canonicalize()) {
            c.starts_with(&p)
        } else {
            // Fallback: simple prefix check
            let parent_str = parent.to_string_lossy();
            let child_str = child.to_string_lossy();
            child_str.starts_with(parent_str.as_ref())
        }
    }

    /// Find all instances of a target file/directory by searching upward from start
    ///
    /// # Arguments
    /// * `target` - The file or directory name to search for
    /// * `start` - The directory to start searching from
    /// * `stop` - Optional directory to stop searching at
    ///
    /// # Returns
    /// A vector of paths where the target was found, from start upward
    pub async fn find_up(
        target: &str,
        start: impl AsRef<Path>,
        stop: Option<&Path>,
    ) -> Vec<PathBuf> {
        let mut current = start.as_ref().to_path_buf();
        let mut result = Vec::new();

        loop {
            let search = current.join(target);
            if fs::try_exists(&search).await.unwrap_or(false) {
                result.push(search);
            }

            if stop.is_some_and(|s| s == current) {
                break;
            }

            match current.parent() {
                Some(parent) if parent != current => {
                    current = parent.to_path_buf();
                }
                _ => break,
            }
        }

        result
    }

    /// Get the relative path from base to target
    pub fn relative(base: impl AsRef<Path>, target: impl AsRef<Path>) -> PathBuf {
        pathdiff::diff_paths(target.as_ref(), base.as_ref())
            .unwrap_or_else(|_| target.as_ref().to_path_buf())
    }
}

// Add pathdiff dependency for path difference calculation
mod pathdiff {
    use std::path::{Component, Path, PathBuf};

    /// Calculate the relative path from base to target
    pub fn diff_paths<P: AsRef<Path>, Q: AsRef<Path>>(target: P, base: Q) -> Result<PathBuf, ()> {
        let target = target.as_ref();
        let base = base.as_ref();

        let mut target_iter = target.components().peekable();
        let mut base_iter = base.components().peekable();

        // Skip common prefix
        while target_iter.peek() == base_iter.peek() {
            if target_iter.peek().is_none() {
                break;
            }
            target_iter.next();
            base_iter.next();
        }

        // Count remaining base components (need to go up)
        let mut result = PathBuf::new();
        for component in base_iter {
            if matches!(component, Component::Normal(_)) {
                result.push("..");
            }
        }

        // Add remaining target components
        for component in target_iter {
            result.push(component);
        }

        if result.as_os_str().is_empty() {
            Ok(PathBuf::from("."))
        } else {
            Ok(result)
        }
    }
}
