//! Binary file detection utilities
//!
//! Provides utilities to detect if a file is binary, matching the logic
//! in the JavaScript implementation's read tool.

use std::path::Path;

/// Known binary file extensions
const BINARY_EXTENSIONS: &[&str] = &[
    ".zip", ".tar", ".gz", ".exe", ".dll", ".so", ".class", ".jar", ".war", ".7z", ".doc", ".docx",
    ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp", ".bin", ".dat", ".obj", ".o", ".a",
    ".lib", ".wasm", ".pyc", ".pyo",
];

/// Known image file extensions
const IMAGE_EXTENSIONS: &[&str] = &[
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff", ".tif", ".svg", ".ico", ".avif",
];

/// Check if a file extension indicates a binary file
fn is_binary_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| {
            let ext_lower = format!(".{}", ext.to_lowercase());
            BINARY_EXTENSIONS.contains(&ext_lower.as_str())
        })
        .unwrap_or(false)
}

/// Check if a file extension indicates an image file
pub fn is_image_extension(path: &Path) -> Option<&'static str> {
    path.extension().and_then(|e| e.to_str()).and_then(|ext| {
        let ext_lower = format!(".{}", ext.to_lowercase());
        match ext_lower.as_str() {
            ".jpg" | ".jpeg" => Some("JPEG"),
            ".png" => Some("PNG"),
            ".gif" => Some("GIF"),
            ".bmp" => Some("BMP"),
            ".webp" => Some("WebP"),
            ".tiff" | ".tif" => Some("TIFF"),
            ".svg" => Some("SVG"),
            ".ico" => Some("ICO"),
            ".avif" => Some("AVIF"),
            _ => None,
        }
    })
}

/// Check if file content appears to be binary
///
/// This checks:
/// 1. Known binary extensions
/// 2. Presence of null bytes
/// 3. High percentage of non-printable characters
pub fn is_binary_file(path: &Path, content: &[u8]) -> bool {
    // Check extension first
    if is_binary_extension(path) {
        return true;
    }

    // Empty files are not binary
    if content.is_empty() {
        return false;
    }

    // Check first 4KB for binary content
    let check_size = content.len().min(4096);
    let bytes = &content[..check_size];

    // Check for null bytes (definite binary indicator)
    if bytes.contains(&0) {
        return true;
    }

    // Count non-printable characters
    let non_printable_count = bytes
        .iter()
        .filter(|&&b| b < 9 || (b > 13 && b < 32))
        .count();

    // If >30% non-printable characters, consider it binary
    (non_printable_count as f64 / bytes.len() as f64) > 0.3
}

/// Image format signatures (magic bytes)
pub mod signatures {
    /// PNG signature: 89 50 4E 47 0D 0A 1A 0A
    pub const PNG: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    /// JPEG signature: FF D8 FF
    pub const JPEG: &[u8] = &[0xFF, 0xD8, 0xFF];

    /// GIF signature: GIF8
    pub const GIF: &[u8] = &[0x47, 0x49, 0x46, 0x38];

    /// BMP signature: BM
    pub const BMP: &[u8] = &[0x42, 0x4D];

    /// WebP signature: RIFF
    pub const WEBP_RIFF: &[u8] = &[0x52, 0x49, 0x46, 0x46];

    /// WebP at offset 8
    pub const WEBP_WEBP: &[u8] = &[0x57, 0x45, 0x42, 0x50];

    /// TIFF little-endian: II
    pub const TIFF_LE: &[u8] = &[0x49, 0x49, 0x2A, 0x00];

    /// TIFF big-endian: MM
    pub const TIFF_BE: &[u8] = &[0x4D, 0x4D, 0x00, 0x2A];

    /// ICO signature
    pub const ICO: &[u8] = &[0x00, 0x00, 0x01, 0x00];
}

/// Validate that file content matches expected image format
pub fn validate_image_format(bytes: &[u8], expected_format: &str) -> bool {
    // Need at least 8 bytes for most formats
    if bytes.len() < 8 && expected_format != "SVG" {
        return false;
    }

    match expected_format {
        "PNG" => bytes.starts_with(signatures::PNG),
        "JPEG" => bytes.starts_with(signatures::JPEG),
        "GIF" => bytes.starts_with(signatures::GIF),
        "BMP" => bytes.starts_with(signatures::BMP),
        "WebP" => {
            bytes.starts_with(signatures::WEBP_RIFF)
                && bytes.len() >= 12
                && &bytes[8..12] == signatures::WEBP_WEBP
        }
        "TIFF" => bytes.starts_with(signatures::TIFF_LE) || bytes.starts_with(signatures::TIFF_BE),
        "ICO" => bytes.starts_with(signatures::ICO),
        "SVG" => {
            let text = String::from_utf8_lossy(&bytes[..bytes.len().min(1000)]);
            text.contains("<svg") || text.contains("<?xml")
        }
        "AVIF" => {
            if bytes.len() < 12 {
                return false;
            }
            // Check for 'ftyp' at offset 4
            let has_ftyp = &bytes[4..8] == b"ftyp";
            if !has_ftyp {
                return false;
            }
            // Check for avif/avis brand
            let brand = std::str::from_utf8(&bytes[8..12]).unwrap_or("");
            brand == "avif" || brand == "avis"
        }
        _ => true, // Unknown format, skip validation
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_binary_extension_detection() {
        assert!(is_binary_extension(&PathBuf::from("file.exe")));
        assert!(is_binary_extension(&PathBuf::from("archive.zip")));
        assert!(is_binary_extension(&PathBuf::from("data.bin")));
        assert!(!is_binary_extension(&PathBuf::from("code.rs")));
        assert!(!is_binary_extension(&PathBuf::from("readme.txt")));
    }

    #[test]
    fn test_image_extension_detection() {
        assert_eq!(
            is_image_extension(&PathBuf::from("photo.jpg")),
            Some("JPEG")
        );
        assert_eq!(is_image_extension(&PathBuf::from("icon.PNG")), Some("PNG"));
        assert_eq!(is_image_extension(&PathBuf::from("code.rs")), None);
    }

    #[test]
    fn test_binary_content_detection() {
        let path = PathBuf::from("test.txt");

        // Text content
        let text = b"Hello, World!";
        assert!(!is_binary_file(&path, text));

        // Binary content with null byte
        let binary = b"Hello\x00World";
        assert!(is_binary_file(&path, binary));

        // Empty file
        assert!(!is_binary_file(&path, &[]));
    }

    #[test]
    fn test_image_format_validation() {
        // Valid PNG
        let png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        assert!(validate_image_format(&png, "PNG"));

        // Invalid PNG (wrong signature)
        let not_png = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
        assert!(!validate_image_format(&not_png, "PNG"));

        // Valid JPEG
        let jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46];
        assert!(validate_image_format(&jpeg, "JPEG"));
    }
}
