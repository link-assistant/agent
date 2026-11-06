// UTF-8 byte-order-mark helpers, ported from upstream OpenCode
// (packages/opencode/src/util/bom.ts, PR #23797). `Bun.file().text()` and
// `TextDecoder` drop the BOM by default, so tools that read-modify-write a
// file must decode with `ignoreBOM: true` and re-attach it on write.
export namespace Bom {
  const BOM_CODE = 0xfeff;
  const BOM = String.fromCharCode(BOM_CODE);

  export function split(text: string) {
    if (text.charCodeAt(0) !== BOM_CODE) return { bom: false, text };
    return { bom: true, text: text.slice(1) };
  }

  export function join(text: string, bom: boolean) {
    const stripped = split(text).text;
    if (!bom) return stripped;
    return BOM + stripped;
  }

  export async function readFile(filePath: string) {
    const bytes = await Bun.file(filePath).arrayBuffer();
    return split(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes));
  }

  // Checks only the first three bytes (EF BB BF), without reading the file.
  export async function has(filePath: string) {
    const head = new Uint8Array(
      await Bun.file(filePath).slice(0, 3).arrayBuffer()
    );
    return head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf;
  }
}
