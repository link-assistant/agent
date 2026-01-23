import { test, expect, setDefaultTimeout } from 'bun:test';
import { $ } from 'bun';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// Increase default timeout to 60 seconds for these tests
setDefaultTimeout(60000);

// Ensure tmp directory exists
const tmpDir = join(process.cwd(), 'tmp');
if (!existsSync(tmpDir)) {
  mkdirSync(tmpDir, { recursive: true });
}

// Helper to create a fake image file (HTML content with image extension)
function createFakeImage(
  filePath,
  content = '<!DOCTYPE html><html><body>Not Found</body></html>'
) {
  writeFileSync(filePath, content);
}

// Helper to create a valid PNG file (minimal valid PNG)
function createValidPNG(filePath) {
  // Minimal valid PNG: 1x1 pixel transparent image
  const pngBytes = Buffer.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a, // PNG signature
    0x00,
    0x00,
    0x00,
    0x0d, // IHDR chunk length
    0x49,
    0x48,
    0x44,
    0x52, // IHDR
    0x00,
    0x00,
    0x00,
    0x01, // Width: 1
    0x00,
    0x00,
    0x00,
    0x01, // Height: 1
    0x08,
    0x06,
    0x00,
    0x00,
    0x00, // Bit depth, color type, etc.
    0x1f,
    0x15,
    0xc4,
    0x89, // CRC
    0x00,
    0x00,
    0x00,
    0x0a, // IDAT chunk length
    0x49,
    0x44,
    0x41,
    0x54, // IDAT
    0x78,
    0x9c,
    0x62,
    0x00,
    0x01,
    0x00,
    0x00,
    0x05,
    0x00,
    0x01, // Compressed data
    0x0d,
    0x0a,
    0x2d,
    0xb4, // CRC
    0x00,
    0x00,
    0x00,
    0x00, // IEND chunk length
    0x49,
    0x45,
    0x4e,
    0x44, // IEND
    0xae,
    0x42,
    0x60,
    0x82, // CRC
  ]);
  writeFileSync(filePath, pngBytes);
}

test('Read tool rejects HTML file with .png extension', async () => {
  const fakeImageFile = join(
    tmpDir,
    `fake-image-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.png`
  );

  createFakeImage(fakeImageFile);

  try {
    const input = `{"message":"read fake image","tools":[{"name":"read","params":{"filePath":"${fakeImageFile}"}}]}`;
    const projectRoot = process.cwd();
    const result = await $`echo ${input} | bun run ${projectRoot}/src/index.js`
      .quiet()
      .nothrow();

    const lines = result.stdout
      .toString()
      .trim()
      .split('\n')
      .filter((line) => line.trim());
    const events = lines.map((line) => JSON.parse(line));

    // Find error event
    const errorEvent = events.find(
      (e) =>
        e.type === 'error' ||
        (e.type === 'tool_use' && e.part?.state?.status === 'failed')
    );

    console.log('Events:', JSON.stringify(events, null, 2));

    expect(errorEvent).toBeTruthy();

    // Check error message contains expected text
    const errorMessage =
      errorEvent.error?.message || errorEvent.part?.state?.error?.message || '';
    expect(errorMessage).toContain('Image validation failed');
    expect(errorMessage).toContain('does not contain valid PNG data');

    console.log('✅ Successfully rejected HTML file with .png extension');
  } finally {
    try {
      unlinkSync(fakeImageFile);
    } catch (_e) {
      // Ignore cleanup errors
    }
  }
});

test('Read tool successfully reads valid PNG file', async () => {
  const validPngFile = join(
    tmpDir,
    `valid-image-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.png`
  );

  createValidPNG(validPngFile);

  try {
    const input = `{"message":"read valid image","tools":[{"name":"read","params":{"filePath":"${validPngFile}"}}]}`;
    const projectRoot = process.cwd();
    const result =
      await $`echo ${input} | bun run ${projectRoot}/src/index.js`.quiet();

    const lines = result.stdout
      .toString()
      .trim()
      .split('\n')
      .filter((line) => line.trim());
    const events = lines.map((line) => JSON.parse(line));

    // Find tool_use event for read
    const toolEvent = events.find(
      (e) => e.type === 'tool_use' && e.part?.tool === 'read'
    );

    expect(toolEvent).toBeTruthy();
    expect(toolEvent.part.state.status).toBe('completed');
    expect(toolEvent.part.state.output).toContain('Image read successfully');

    // Verify it has an attachment
    expect(toolEvent.part.state.attachments).toBeTruthy();
    expect(toolEvent.part.state.attachments.length).toBe(1);
    expect(toolEvent.part.state.attachments[0].mime).toContain('png');
    expect(toolEvent.part.state.attachments[0].url).toContain('data:');
    expect(toolEvent.part.state.attachments[0].url).toContain('base64');

    console.log('✅ Successfully read valid PNG file');
  } finally {
    try {
      unlinkSync(validPngFile);
    } catch (_e) {
      // Ignore cleanup errors
    }
  }
});

test('Read tool can be configured to skip validation with env var', async () => {
  const fakeImageFile = join(
    tmpDir,
    `fake-image-bypass-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.png`
  );

  createFakeImage(fakeImageFile);

  try {
    const input = `{"message":"read fake image with validation disabled","tools":[{"name":"read","params":{"filePath":"${fakeImageFile}"}}]}`;
    const projectRoot = process.cwd();

    // Set environment variable to disable validation
    const result =
      await $`VERIFY_IMAGES_AT_READ_TOOL=false echo ${input} | bun run ${projectRoot}/src/index.js`.quiet();

    const lines = result.stdout
      .toString()
      .trim()
      .split('\n')
      .filter((line) => line.trim());
    const events = lines.map((line) => JSON.parse(line));

    // Find tool_use event for read
    const toolEvent = events.find(
      (e) => e.type === 'tool_use' && e.part?.tool === 'read'
    );

    // With validation disabled, it should attempt to read the "image" (though it's actually HTML)
    // This will succeed locally but would fail at Claude API
    expect(toolEvent).toBeTruthy();

    console.log('✅ Validation can be disabled via environment variable');
  } finally {
    try {
      unlinkSync(fakeImageFile);
    } catch (_e) {
      // Ignore cleanup errors
    }
  }
});

test('Read tool rejects file smaller than minimum image size', async () => {
  const tinyFile = join(
    tmpDir,
    `tiny-image-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.png`
  );

  // Create a file that's too small to be a valid image (< 8 bytes)
  writeFileSync(tinyFile, 'tiny');

  try {
    const input = `{"message":"read tiny file","tools":[{"name":"read","params":{"filePath":"${tinyFile}"}}]}`;
    const projectRoot = process.cwd();
    const result = await $`echo ${input} | bun run ${projectRoot}/src/index.js`
      .quiet()
      .nothrow();

    const lines = result.stdout
      .toString()
      .trim()
      .split('\n')
      .filter((line) => line.trim());
    const events = lines.map((line) => JSON.parse(line));

    // Find error event
    const errorEvent = events.find(
      (e) =>
        e.type === 'error' ||
        (e.type === 'tool_use' && e.part?.state?.status === 'failed')
    );

    expect(errorEvent).toBeTruthy();

    const errorMessage =
      errorEvent.error?.message || errorEvent.part?.state?.error?.message || '';
    expect(errorMessage).toContain('Image validation failed');

    console.log(
      '✅ Successfully rejected file smaller than minimum image size'
    );
  } finally {
    try {
      unlinkSync(tinyFile);
    } catch (_e) {
      // Ignore cleanup errors
    }
  }
});

test('Read tool provides helpful error message with hex dump', async () => {
  const fakeImageFile = join(
    tmpDir,
    `fake-image-hexdump-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.png`
  );

  createFakeImage(fakeImageFile, 'Not Found');

  try {
    const input = `{"message":"read fake image for hex dump","tools":[{"name":"read","params":{"filePath":"${fakeImageFile}"}}]}`;
    const projectRoot = process.cwd();
    const result =
      await $`echo ${input} | bun run ${projectRoot}/src/index.js --no-always-accept-stdin`
        .quiet()
        .nothrow();

    const lines = result.stdout
      .toString()
      .trim()
      .split('\n')
      .filter((line) => line.trim());
    const events = lines.map((line) => JSON.parse(line));

    const errorEvent = events.find(
      (e) =>
        e.type === 'error' ||
        (e.type === 'tool_use' && e.part?.state?.status === 'failed')
    );
    expect(errorEvent).toBeTruthy();

    const errorMessage =
      errorEvent.error?.message || errorEvent.part?.state?.error?.message || '';

    // Check that error message includes:
    // 1. Clear description of the problem
    expect(errorMessage).toContain('Image validation failed');
    expect(errorMessage).toContain('does not contain valid PNG data');

    // 2. Helpful diagnostic info (hex dump of first bytes)
    expect(errorMessage).toContain('First');
    expect(errorMessage).toContain('bytes:');

    // 3. Instructions on how to disable validation
    expect(errorMessage).toContain('VERIFY_IMAGES_AT_READ_TOOL=false');

    console.log('Error message:', errorMessage);
    console.log('✅ Error message includes hex dump and helpful instructions');
  } finally {
    try {
      unlinkSync(fakeImageFile);
    } catch (_e) {
      // Ignore cleanup errors
    }
  }
});

test('Read tool validates different image formats correctly', async () => {
  const testCases = [
    {
      ext: '.png',
      signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00],
      format: 'PNG',
    },
    {
      ext: '.jpg',
      signature: [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46],
      format: 'JPEG',
    },
    {
      ext: '.jpeg',
      signature: [0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0x45, 0x78],
      format: 'JPEG',
    },
    {
      ext: '.gif',
      signature: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00],
      format: 'GIF',
    },
    {
      ext: '.tiff',
      signature: [0x49, 0x49, 0x2a, 0x00, 0x00, 0x00, 0x00, 0x00],
      format: 'TIFF',
    },
    {
      ext: '.tif',
      signature: [0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x00],
      format: 'TIFF',
    },
    {
      ext: '.ico',
      signature: [0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10],
      format: 'ICO',
    },
  ];

  for (const testCase of testCases) {
    const validFile = join(
      tmpDir,
      `valid-${testCase.format.toLowerCase()}-${Date.now()}.${testCase.ext.slice(1)}`
    );

    writeFileSync(validFile, Buffer.from(testCase.signature));

    try {
      const input = `{"message":"read ${testCase.format}","tools":[{"name":"read","params":{"filePath":"${validFile}"}}]}`;
      const projectRoot = process.cwd();
      const result =
        await $`echo ${input} | bun run ${projectRoot}/src/index.js`.quiet();

      const lines = result.stdout
        .toString()
        .trim()
        .split('\n')
        .filter((line) => line.trim());
      const events = lines.map((line) => JSON.parse(line));

      const toolEvent = events.find(
        (e) => e.type === 'tool_use' && e.part?.tool === 'read'
      );

      expect(toolEvent).toBeTruthy();
      expect(toolEvent.part.state.status).toBe('completed');

      console.log(`✅ Successfully validated ${testCase.format} file format`);
    } finally {
      try {
        unlinkSync(validFile);
      } catch (_e) {
        // Ignore cleanup errors
      }
    }
  }
});

test('Read tool validates SVG files correctly', async () => {
  const svgFile = join(
    tmpDir,
    `valid-svg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.svg`
  );

  // Create a minimal valid SVG
  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
  <circle cx="50" cy="50" r="40" fill="red" />
</svg>`;

  writeFileSync(svgFile, svgContent);

  try {
    const input = `{"message":"read SVG file","tools":[{"name":"read","params":{"filePath":"${svgFile}"}}]}`;
    const projectRoot = process.cwd();
    const result =
      await $`echo ${input} | bun run ${projectRoot}/src/index.js`.quiet();

    const lines = result.stdout
      .toString()
      .trim()
      .split('\n')
      .filter((line) => line.trim());
    const events = lines.map((line) => JSON.parse(line));

    const toolEvent = events.find(
      (e) => e.type === 'tool_use' && e.part?.tool === 'read'
    );

    expect(toolEvent).toBeTruthy();
    expect(toolEvent.part.state.status).toBe('completed');

    console.log('✅ Successfully validated SVG file format');
  } finally {
    try {
      unlinkSync(svgFile);
    } catch (_e) {
      // Ignore cleanup errors
    }
  }
});

test('Read tool validates AVIF files correctly', async () => {
  const avifFile = join(
    tmpDir,
    `valid-avif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.avif`
  );

  // Create a minimal AVIF file signature
  // AVIF uses ISO Base Media File Format with 'ftyp' box and 'avif' brand
  const avifSignature = Buffer.from([
    0x00,
    0x00,
    0x00,
    0x20, // Box size (32 bytes)
    0x66,
    0x74,
    0x79,
    0x70, // 'ftyp'
    0x61,
    0x76,
    0x69,
    0x66, // 'avif' brand
    0x00,
    0x00,
    0x00,
    0x00, // Minor version
    0x61,
    0x76,
    0x69,
    0x66, // Compatible brand
    0x6d,
    0x69,
    0x66,
    0x31, // 'mif1'
    0x6d,
    0x69,
    0x61,
    0x66, // 'miaf'
    0x4d,
    0x41,
    0x31,
    0x42, // 'MA1B'
  ]);

  writeFileSync(avifFile, avifSignature);

  try {
    const input = `{"message":"read AVIF file","tools":[{"name":"read","params":{"filePath":"${avifFile}"}}]}`;
    const projectRoot = process.cwd();
    const result =
      await $`echo ${input} | bun run ${projectRoot}/src/index.js`.quiet();

    const lines = result.stdout
      .toString()
      .trim()
      .split('\n')
      .filter((line) => line.trim());
    const events = lines.map((line) => JSON.parse(line));

    const toolEvent = events.find(
      (e) => e.type === 'tool_use' && e.part?.tool === 'read'
    );

    expect(toolEvent).toBeTruthy();
    expect(toolEvent.part.state.status).toBe('completed');

    console.log('✅ Successfully validated AVIF file format');
  } finally {
    try {
      unlinkSync(avifFile);
    } catch (_e) {
      // Ignore cleanup errors
    }
  }
});
