import z from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { Tool } from './tool';
import { FileTime } from '../file/time';
import DESCRIPTION from './read.txt';
import { config } from '../config/config';
import { Instance } from '../project/instance';
import { Provider } from '../provider/provider';
import { Identifier } from '../id/id';
import { formatBalancedLineWindow, formatColumnWindow } from './text-window';

const DEFAULT_READ_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;
// upstream 1b82511fbd / c1b03b728a (#14009): bound the output in bytes too,
// 2000 long lines would otherwise put megabytes into the context.
const MAX_BYTES = 50 * 1024;

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
    columnOffset: z.coerce
      .number()
      .describe('The column number to start reading from (0-based)')
      .optional(),
    columnLimit: z.coerce
      .number()
      .describe('The number of columns to read from each selected line')
      .optional(),
  }),
  async execute(params, ctx) {
    let filepath = params.filePath;
    if (!path.isAbsolute(filepath)) {
      // Relative to the session directory, like every other tool, not to the
      // worktree root (upstream 6cf2c3e3db).
      filepath = path.resolve(Instance.directory, filepath);
    }

    // No restrictions - unrestricted file read
    let stat = await fs.promises.stat(filepath).catch(() => undefined);
    if (!stat) {
      const alternate = alternatePath(filepath);
      if (alternate) {
        filepath = alternate;
        stat = await fs.promises.stat(filepath).catch(() => undefined);
      }
    }
    const title = path.relative(Instance.worktree, filepath);
    if (!stat) {
      const dir = path.dirname(filepath);
      const base = path.basename(filepath);

      // A missing parent directory is still just "File not found".
      const dirEntries = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
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
    // upstream 823d327401 / ff837fe949 (#33255/#33260)
    if (stat.isDirectory()) {
      throw new Error(
        `Path is a directory, not a file: ${filepath}. Use the ls or glob tool to list it.`
      );
    }
    if (!stat.isFile()) {
      throw new Error(`Path is not a regular file: ${filepath}`);
    }
    const file = Bun.file(filepath);

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
      // Image format validation (can be disabled via LINK_ASSISTANT_AGENT_VERIFY_IMAGES_AT_READ_TOOL)
      const verifyImages = config.verifyImagesAtReadTool;
      if (verifyImages && !supportsImages) {
        throw new Error(
          `Failed to read image: ${filepath}, model may not be able to read images`
        );
      }
      const bytes = await file.bytes();
      if (verifyImages) {
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
              `To disable image validation, set environment variable: LINK_ASSISTANT_AGENT_VERIFY_IMAGES_AT_READ_TOOL=false`
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
            url: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`,
          },
        ],
      };
    }

    const isBinary = await isBinaryFile(filepath, stat.size);
    if (isBinary) throw new Error(`Cannot read binary file: ${filepath}`);

    // upstream 683d470fe4 (#51011): never return more than the default limit
    const limit = Math.min(
      normalizeNonNegativeInteger(params.limit, DEFAULT_READ_LIMIT),
      DEFAULT_READ_LIMIT
    );
    const offset = normalizeNonNegativeInteger(params.offset, 0);
    const hasExplicitLineRange =
      params.offset !== undefined || params.limit !== undefined;
    const hasExplicitColumnRange =
      params.columnOffset !== undefined || params.columnLimit !== undefined;
    const columnOffset = normalizeNonNegativeInteger(params.columnOffset, 0);
    const columnLimit = Math.min(
      normalizeNonNegativeInteger(params.columnLimit, MAX_LINE_LENGTH),
      MAX_BYTES
    );
    const lines = splitLines(await file.text());
    // upstream c1b03b728a (#14009)
    if (hasExplicitLineRange && lines.length > 0 && offset >= lines.length) {
      throw new Error(
        `Offset ${offset} is out of range for this file (${lines.length} lines)`
      );
    }
    const selected = selectLines({
      lines,
      offset,
      limit,
      summarizeMiddle: !hasExplicitLineRange,
    });
    const formatLine = ({
      line,
      lineNumber,
    }: {
      line: string;
      lineNumber: number;
    }) => {
      const formattedLine = hasExplicitColumnRange
        ? formatColumnWindow({
            line,
            lineNumber,
            offset: columnOffset,
            limit: columnLimit,
          })
        : formatBalancedLineWindow({
            line,
            lineNumber,
            limit: MAX_LINE_LENGTH,
          });
      return `${lineNumber.toString().padStart(5, '0')}| ${formattedLine}`;
    };

    const content: string[] = [];
    let bytes = 0;
    let capped: { first: number; last: number } | undefined;
    for (const part of selected.parts) {
      if (part.type === 'omitted') {
        content.push(`... [omitted lines ${part.start}..${part.end}] ...`);
        continue;
      }
      for (const item of part.lines) {
        const formatted = formatLine(item);
        const size = Buffer.byteLength(formatted, 'utf8') + 1;
        // Always show at least one line so the cap cannot return nothing.
        if (bytes + size > MAX_BYTES && content.length > 0) {
          capped = {
            first: part.lines[0].lineNumber,
            last: item.lineNumber - 1,
          };
          break;
        }
        content.push(formatted);
        bytes += size;
      }
      if (capped) break;
    }
    const preview = content.slice(0, 20).join('\n');

    let output = '<file>\n';
    output += content.join('\n');

    const totalLines = lines.length;
    const lastReadLine = selected.lastLine;
    const hasMoreLines = hasExplicitLineRange && totalLines > lastReadLine;

    if (capped) {
      // `offset` is 0-based, so the next unread line starts at `last`.
      output += `\n\n(Output capped at 50 KB. Showing lines ${capped.first}-${capped.last}. Use offset=${capped.last} to continue.)`;
    } else if (hasMoreLines) {
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

// CRLF files must not leak `\r` into the output, and a trailing newline ends
// the last line instead of starting an empty one (upstream c1b03b728a,
// 683d470fe4).
function splitLines(text: string) {
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// macOS puts U+202F (narrow no-break space) before AM/PM in screenshot names
// and models type a plain space; curly apostrophes get straightened the same
// way. Use the only directory entry that matches after canonicalizing both
// (upstream d484f070d1 #45807, b47824fb63 #50953).
function canonicalName(name: string) {
  return name
    .normalize('NFC')
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/[\u2018\u2019]/g, "'");
}

function alternatePath(filepath: string): string | undefined {
  const dir = path.dirname(filepath);
  const base = canonicalName(path.basename(filepath));
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return undefined;
  }
  const matches = entries.filter((entry) => canonicalName(entry) === base);
  if (matches.length !== 1) return undefined;
  return path.join(dir, matches[0]);
}

function normalizeNonNegativeInteger(
  value: number | undefined,
  fallback: number
) {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

type SelectedLinePart =
  | {
      type: 'lines';
      lines: Array<{ line: string; lineNumber: number }>;
    }
  | {
      type: 'omitted';
      start: number;
      end: number;
    };

function selectLines(input: {
  lines: string[];
  offset: number;
  limit: number;
  summarizeMiddle: boolean;
}): { parts: SelectedLinePart[]; lastLine: number } {
  const totalLines = input.lines.length;

  if (!input.summarizeMiddle || totalLines <= input.limit) {
    const end = Math.min(input.offset + input.limit, totalLines);
    return {
      parts: [
        {
          type: 'lines',
          lines: lineRange(input.lines, input.offset, end),
        },
      ],
      lastLine: end,
    };
  }

  const headCount = Math.ceil(input.limit / 2);
  const tailCount = input.limit - headCount;
  const tailStart = totalLines - tailCount;
  const omittedStart = headCount + 1;
  const omittedEnd = tailStart;

  return {
    parts: [
      {
        type: 'lines',
        lines: lineRange(input.lines, 0, headCount),
      },
      {
        type: 'omitted',
        start: omittedStart,
        end: omittedEnd,
      },
      {
        type: 'lines',
        lines: lineRange(input.lines, tailStart, totalLines),
      },
    ],
    lastLine: totalLines,
  };
}

function lineRange(lines: string[], start: number, end: number) {
  return lines.slice(start, end).map((line, index) => ({
    line,
    lineNumber: start + index + 1,
  }));
}

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
  fileSize: number
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

  if (fileSize === 0) return false;

  // Sample only the first 4 KB instead of loading the whole file
  // (upstream c1b03b728a #14009).
  const bufferSize = Math.min(4096, fileSize);
  const fh = await fs.promises.open(filepath, 'r');
  const sample = Buffer.alloc(bufferSize);
  const { bytesRead } = await fh
    .read(sample, 0, bufferSize, 0)
    .finally(() => fh.close());
  if (bytesRead === 0) return false;
  const bytes = sample.subarray(0, bytesRead);

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
