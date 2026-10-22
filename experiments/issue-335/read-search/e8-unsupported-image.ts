// read.ts L69 + L105-124: extension-based image detection sends these mimes as tool attachments,
// which message-v2.ts L747-761 replays as user file parts on every later turn.
import path from 'path';
import fs from 'fs';
function isImageFile(p: string) {
  // copied from read.ts L271-297
  switch (path.extname(p).toLowerCase()) {
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
const SUPPORTED = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]); // upstream 51e310c9ce
const d = '/tmp/issue-335-read-search/fx-img';
fs.mkdirSync(d, { recursive: true });
for (const ext of ['png', 'svg', 'bmp', 'tiff', 'ico', 'avif']) {
  const f = `${d}/x.${ext}`;
  fs.writeFileSync(
    f,
    ext === 'svg' ? '<svg xmlns="http://www.w3.org/2000/svg"/>' : 'x'
  );
  const mime = Bun.file(f).type;
  console.log(
    `.${ext}: ours isImage=${isImageFile(f)} attachment mime=${mime} -> provider-supported=${SUPPORTED.has(mime.split(';')[0])}`
  );
}
fs.rmSync(d, { recursive: true });
