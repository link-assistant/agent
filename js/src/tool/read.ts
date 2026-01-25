import z from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { Tool } from './tool';
import { FileTime } from '../file/time';
import DESCRIPTION from './read.txt';
import { Filesystem } from '../util/filesystem';
import { Instance } from '../project/instance';
import { Provider } from '../provider/provider';
import { Identifier } from '../id/id';
import { iife } from '../util/iife';

const DEFAULT_READ_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;

export const ReadTool = Tool.define('read', {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe('The path to the file to read'),
    offset: z.coerce
      .number()
      .describe('The line number to start reading from (0-based)')
      .optional(),
    limit: z.coerce
      .number()
      .describe('The number of lines to read (defaults to 2000)')
      .optional(),
  }),
  async execute(params, ctx) {
    let filepath = params.filePath;
    if (!path.isAbsolute(filepath)) {
      filepath = path.join(Instance.worktree, filepath);
    }
    const title = path.relative(Instance.worktree, filepath);

    // No restrictions - unrestricted file read
    const file = Bun.file(filepath);
    if (!(await file.exists())) {
      const dir = path.dirname(filepath);
      const base = path.basename(filepath);

      const dirEntries = fs.readdirSync(dir);
      const suggestions = dirEntries
        .filter(
          (entry) =>
            entry.toLowerCase().includes(base.toLowerCase()) ||
            base.toLowerCase().includes(entry.toLowerCase())
        )
        .map((entry) => path.join(dir, entry))
        .slice(0, 3);

      if (suggestions.length > 0) {
        throw new Error(
          `File not found: ${filepath}\n\nDid you mean one of these?\n${suggestions.join('\n')}`
        );
      }

      throw new Error(`File not found: ${filepath}`);
    }

    const isImage = isImageFile(filepath);
    const supportsImages = await (async () => {
      if (!ctx.extra?.['providerID'] || !ctx.extra?.['modelID']) return false;
      const providerID = ctx.extra['providerID'] as string;
      const modelID = ctx.extra['modelID'] as string;
      const model = await Provider.getModel(providerID, modelID).catch(
        () => undefined
      );
      if (!model) return false;
      return model.info.modalities?.input?.includes('image') ?? false;
    })();
    if (isImage) {
      // Image format validation (can be disabled via environment variable)
      const verifyImages = process.env.VERIFY_IMAGES_AT_READ_TOOL !== 'false';
      if (verifyImages && !supportsImages) {
        throw new Error(
          `Failed to read image: ${filepath}, model may not be able to read images`
        );
      }
      if (verifyImages) {
        const bytes = new Uint8Array(await file.arrayBuffer());

        // Validate image format matches file extension
        if (!validateImageFormat(bytes, isImage)) {
          throw new Error(
            `Image validation failed: ${filepath} has image extension but does not contain valid ${isImage} data.\n` +
              `The file may be corrupted, misnamed, or contain non-image content (e.g., HTML error page).\n` +
              `First ${Math.min(bytes.length, 50)} bytes: ${Array.from(
                bytes.slice(0, 50)
              )
                .map((b) => b.toString(16).padStart(2, '0'))
                .join(' ')}\n` +
              `To disable image validation, set environment variable: VERIFY_IMAGES_AT_READ_TOOL=false`
          );
        }
      }

      const mime = file.type;
      const msg = 'Image read successfully';
      return {
        title,
        output: msg,
        metadata: {
          preview: msg,
        },
        attachments: [
          {
            id: Identifier.ascending('part'),
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            type: 'file',
            mime,
            url: `data:${mime};base64,${Buffer.from(await file.bytes()).toString('base64')}`,
          },
        ],
      };
    }

    const isBinary = await isBinaryFile(filepath, file);
    if (isBinary) throw new Error(`Cannot read binary file: ${filepath}`);

    const limit = params.limit ?? DEFAULT_READ_LIMIT;
    const offset = params.offset || 0;
    const lines = await file.text().then((text) => text.split('\n'));
    const raw = lines.slice(offset, offset + limit).map((line) => {
      return line.length > MAX_LINE_LENGTH
        ? line.substring(0, MAX_LINE_LENGTH) + '...'
        : line;
    });
    const content = raw.map((line, index) => {
      return `${(index + offset + 1).toString().padStart(5, '0')}| ${line}`;
    });
    const preview = raw.slice(0, 20).join('\n');

    let output = '<file>\n';
    output += content.join('\n');

    const totalLines = lines.length;
    const lastReadLine = offset + content.length;
    const hasMoreLines = totalLines > lastReadLine;

    if (hasMoreLines) {
      output += `\n\n(File has more lines. Use 'offset' parameter to read beyond line ${lastReadLine})`;
    } else {
      output += `\n\n(End of file - total ${totalLines} lines)`;
    }
    output += '\n</file>';

    // just warms the lsp client
    FileTime.read(ctx.sessionID, filepath);

    return {
      title,
      output,
      metadata: {
        preview,
      },
    };
  },
});

function isImageFile(filePath: string): string | false {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'JPEG';
    case '.png':
      return 'PNG';
    case '.gif':
      return 'GIF';
    case '.bmp':
      return 'BMP';
    case '.webp':
      return 'WebP';
    case '.tiff':
    case '.tif':
      return 'TIFF';
    case '.svg':
      return 'SVG';
    case '.ico':
      return 'ICO';
    case '.avif':
      return 'AVIF';
    default:
      return false;
  }
}

/**
 * Validates that file content matches expected image format by checking magic bytes/file signatures.
 * This prevents sending invalid data to the Claude API which would cause non-recoverable errors.
 *
 * @param bytes - File content as Uint8Array
 * @param expectedFormat - Expected image format ('PNG', 'JPEG', 'GIF', 'BMP', 'WebP', 'TIFF', 'SVG', 'ICO', 'AVIF')
 * @returns true if file signature matches expected format, false otherwise
 */
function validateImageFormat(
  bytes: Uint8Array,
  expectedFormat: string
): boolean {
  // Need at least 8 bytes for reliable detection (except SVG which needs more for text check)
  if (bytes.length < 8 && expectedFormat !== 'SVG') {
    return false;
  }

  // File signatures (magic bytes) for supported image formats
  // Reference: https://en.wikipedia.org/wiki/List_of_file_signatures
  const signatures: Record<string, number[]> = {
    PNG: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    JPEG: [0xff, 0xd8, 0xff],
    GIF: [0x47, 0x49, 0x46, 0x38], // GIF8 (GIF87a or GIF89a)
    BMP: [0x42, 0x4d], // BM
    WebP: [0x52, 0x49, 0x46, 0x46], // RIFF (need additional check at offset 8)
    TIFF: [0x49, 0x49, 0x2a, 0x00], // Little-endian TIFF, also check big-endian below
    ICO: [0x00, 0x00, 0x01, 0x00], // ICO format
  };

  const sig = signatures[expectedFormat];

  // Special handling for formats with multiple possible signatures
  if (expectedFormat === 'TIFF') {
    // TIFF can be little-endian (II) or big-endian (MM)
    const littleEndian = [0x49, 0x49, 0x2a, 0x00];
    const bigEndian = [0x4d, 0x4d, 0x00, 0x2a];
    const matchesLE = littleEndian.every((byte, i) => bytes[i] === byte);
    const matchesBE = bigEndian.every((byte, i) => bytes[i] === byte);
    return matchesLE || matchesBE;
  }

  if (expectedFormat === 'SVG') {
    // SVG is XML-based, check for common SVG patterns
    const text = new TextDecoder('utf-8', { fatal: false }).decode(
      bytes.slice(0, Math.min(1000, bytes.length))
    );
    return text.includes('<svg') || text.includes('<?xml');
  }

  if (expectedFormat === 'AVIF') {
    // AVIF uses ISOBMFF container with 'ftyp' box
    // Signature: offset 4-7 should be 'ftyp', and offset 8-11 should contain 'avif' or 'avis'
    if (bytes.length < 12) return false;
    const ftyp = [0x66, 0x74, 0x79, 0x70]; // 'ftyp'
    const hasFtyp = ftyp.every((byte, i) => bytes[4 + i] === byte);
    if (!hasFtyp) return false;

    // Check for avif/avis brand
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    return brand === 'avif' || brand === 'avis';
  }

  if (!sig) {
    // Unknown format, skip validation
    return true;
  }

  // Check if file starts with expected signature
  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) {
      return false;
    }
  }

  // Special case for WebP: also check for WEBP at offset 8
  if (expectedFormat === 'WebP') {
    const webpSig = [0x57, 0x45, 0x42, 0x50]; // WEBP
    if (bytes.length < 12) return false;
    for (let i = 0; i < webpSig.length; i++) {
      if (bytes[8 + i] !== webpSig[i]) {
        return false;
      }
    }
  }

  return true;
}

async function isBinaryFile(
  filepath: string,
  file: Bun.BunFile
): Promise<boolean> {
  const ext = path.extname(filepath).toLowerCase();
  // binary check for common non-text extensions
  switch (ext) {
    case '.zip':
    case '.tar':
    case '.gz':
    case '.exe':
    case '.dll':
    case '.so':
    case '.class':
    case '.jar':
    case '.war':
    case '.7z':
    case '.doc':
    case '.docx':
    case '.xls':
    case '.xlsx':
    case '.ppt':
    case '.pptx':
    case '.odt':
    case '.ods':
    case '.odp':
    case '.bin':
    case '.dat':
    case '.obj':
    case '.o':
    case '.a':
    case '.lib':
    case '.wasm':
    case '.pyc':
    case '.pyo':
      return true;
    default:
      break;
  }

  const stat = await file.stat();
  const fileSize = stat.size;
  if (fileSize === 0) return false;

  const bufferSize = Math.min(4096, fileSize);
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength === 0) return false;
  const bytes = new Uint8Array(buffer.slice(0, bufferSize));

  let nonPrintableCount = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return true;
    if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) {
      nonPrintableCount++;
    }
  }
  // If >30% non-printable characters, consider it binary
  return nonPrintableCount / bytes.length > 0.3;
}
