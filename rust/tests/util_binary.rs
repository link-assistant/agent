//! Tests for binary file detection utilities.
//!
//! Extracted from the original inline tests in rust/src/util/binary.rs.

use agent::util::binary::{
    is_binary_extension, is_binary_file, is_image_extension, validate_image_format,
};
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

// --- Additional tests ---

#[test]
fn test_binary_extensions_comprehensive() {
    // Common binary formats
    assert!(is_binary_extension(&PathBuf::from("file.dll")));
    assert!(is_binary_extension(&PathBuf::from("file.so")));
    assert!(is_binary_extension(&PathBuf::from("file.tar")));
    assert!(is_binary_extension(&PathBuf::from("file.gz")));

    // Common text formats
    assert!(!is_binary_extension(&PathBuf::from("file.js")));
    assert!(!is_binary_extension(&PathBuf::from("file.ts")));
    assert!(!is_binary_extension(&PathBuf::from("file.py")));
    assert!(!is_binary_extension(&PathBuf::from("file.json")));
    assert!(!is_binary_extension(&PathBuf::from("file.md")));
}

#[test]
fn test_image_extensions_comprehensive() {
    assert!(is_image_extension(&PathBuf::from("photo.png")).is_some());
    assert!(is_image_extension(&PathBuf::from("photo.gif")).is_some());
    assert!(is_image_extension(&PathBuf::from("photo.webp")).is_some());
    assert!(is_image_extension(&PathBuf::from("photo.bmp")).is_some());
}
