//! Fallible GitHub Actions output writes shared by standalone Rust scripts.

// Keep rust-script from wrapping this module as an expression in test builds.
#[cfg(test)]
#[allow(dead_code)]
fn main() {}

use std::env;
use std::fs::OpenOptions;
use std::io::{self, Write};
use std::path::Path;

/// Append a single-line step output, or do nothing when running locally.
///
/// A configured path, including an empty path, must be opened and written
/// successfully. Preserve non-UTF-8 paths and never substitute a null device.
pub fn write_output(key: &str, value: &str) -> io::Result<()> {
    write_output_to(
        env::var_os("GITHUB_OUTPUT").as_deref().map(Path::new),
        key,
        value,
    )
}

fn write_output_to(path: Option<&Path>, key: &str, value: &str) -> io::Result<()> {
    let Some(path) = path else {
        return Ok(());
    };
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| output_error(path, key, error))?;
    write_record(&mut file, key, value).map_err(|error| output_error(path, key, error))
}

fn write_record(writer: &mut impl Write, key: &str, value: &str) -> io::Result<()> {
    writer.write_all(format!("{key}={value}\n").as_bytes())
}

fn output_error(path: &Path, key: &str, error: io::Error) -> io::Error {
    io::Error::new(
        error.kind(),
        format!(
            "Could not write output '{key}' to GITHUB_OUTPUT '{}': {error}",
            path.display()
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn creates_a_missing_output_file() {
        let root = env::temp_dir().join(format!(
            "new-github-output-{}-{}",
            std::process::id(),
            module_path!().replace("::", "-")
        ));
        fs::create_dir(&root).unwrap();
        let path = root.join("outputs.txt");
        write_output_to(Some(&path), "version", "1.0.0").unwrap();
        let content = fs::read_to_string(&path).unwrap();
        fs::remove_dir_all(root).unwrap();
        assert_eq!(content, "version=1.0.0\n");
    }

    #[test]
    fn appends_without_overwriting_existing_outputs() {
        let path = env::temp_dir().join(format!(
            "github-output-{}-{}.txt",
            std::process::id(),
            module_path!().replace("::", "-")
        ));
        fs::write(&path, "existing=value\n").unwrap();
        write_output_to(Some(&path), "version", "1.0.0").unwrap();
        write_output_to(Some(&path), "empty", "").unwrap();
        let content = fs::read_to_string(&path).unwrap();
        fs::remove_file(path).unwrap();
        assert_eq!(content, "existing=value\nversion=1.0.0\nempty=\n");
    }

    #[test]
    fn configured_directory_reports_path_and_key() {
        let path = env::temp_dir();
        let error = write_output_to(Some(&path), "version", "1.0.0").unwrap_err();
        let message = error.to_string();
        assert!(message.contains("GITHUB_OUTPUT"));
        assert!(message.contains(&path.display().to_string()));
        assert!(message.contains("version"));
    }

    #[test]
    fn empty_configured_path_is_an_error() {
        assert!(write_output_to(Some(Path::new("")), "key", "value").is_err());
    }

    #[test]
    fn absent_output_path_is_supported() {
        write_output_to(None, "key", "value").unwrap();
    }

    #[test]
    fn write_failure_is_returned_after_open() {
        struct FailingWriter;
        impl Write for FailingWriter {
            fn write(&mut self, _: &[u8]) -> io::Result<usize> {
                Err(io::Error::new(
                    io::ErrorKind::WriteZero,
                    "fixture disk full",
                ))
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        let error = write_record(&mut FailingWriter, "version", "1.0.0").unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::WriteZero);
        assert!(error.to_string().contains("fixture disk full"));
    }
}
