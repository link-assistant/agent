/** Scan Markdown without changing offsets, bytes, indentation, or line endings. */
export function markdownLines(text) {
  const lines = [];
  let fence = null;
  for (const match of text.matchAll(/[^\n]*(?:\n|$)/g)) {
    if (!match[0]) {
      continue;
    }
    const raw = match[0];
    const line = raw.replace(/\r?\n$/, '');
    let code = Boolean(fence);
    if (fence) {
      const close = line.match(/^ {0,3}(`+|~+)[ \t]*$/);
      if (
        close &&
        close[1][0] === fence[0] &&
        close[1].length >= fence.length
      ) {
        fence = null;
      }
    } else {
      const open = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (open && (open[1][0] !== '`' || !open[2].includes('`'))) {
        fence = open[1];
        code = true;
      } else {
        code = /^(?: {4}|\t)/.test(line);
      }
    }
    lines.push({
      text: line,
      raw,
      start: match.index,
      end: match.index + raw.length,
      code,
    });
  }
  return lines;
}
