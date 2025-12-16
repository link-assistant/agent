---
'@link-assistant/agent': patch
---

Add comprehensive image validation to prevent API errors

- Added magic byte validation for PNG, JPEG/JPG, GIF, BMP, WebP, TIFF, SVG, ICO, and AVIF formats
- Prevents "Could not process image" API errors from invalid files
- Added `VERIFY_IMAGES_AT_READ_TOOL` environment variable for opt-out (enabled by default)
- Enhanced error messages with hex dump debugging information
- Comprehensive test suite with 6+ test cases
- Fixes #38 and prevents session crashes from corrupted image files
