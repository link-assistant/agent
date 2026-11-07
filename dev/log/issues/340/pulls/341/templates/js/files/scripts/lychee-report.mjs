/** Require a real summary before either fallback can turn failures green. */
export function validateLycheeReport(
  content,
  hasFailures,
  checkerFailed = false
) {
  const heading = /^# (?:Link Checker Report|Summary)[ \t]*\r?$/m.test(content);
  const errors =
    /^\|[^|\r\n]*\bErrors[ \t]*\|[ \t]*\d+[ \t]*\|[ \t]*\r?$/m.test(content);
  const reportedFailure =
    /^\|[^|\r\n]*\b(?:Errors|Timeouts|Unknown)[ \t]*\|[ \t]*[1-9]\d*[ \t]*\|[ \t]*\r?$/m.test(
      content
    );
  if (
    !heading ||
    !errors ||
    Boolean(hasFailures) !== reportedFailure ||
    (checkerFailed && !hasFailures)
  ) {
    throw new Error(
      'Lychee report is empty, malformed, or contains no evidence for the failed checker'
    );
  }
}

export function extractErrorsSection(content, kind = 'Errors') {
  const lines = content.split('\n');
  const start = lines.findIndex(
    (line) => /^#+\s+(Errors|Timeouts) per input\s*$/.exec(line)?.[1] === kind
  );
  if (start === -1) {
    return kind === 'Errors' && !/^#+\s+[^\r\n]+ per input\s*$/m.test(content)
      ? content
      : '';
  }
  const heading = /^(#+)\s/.exec(lines[start])[1].length;
  const section = [];
  for (const line of lines.slice(start + 1)) {
    const next = /^(#+)\s/.exec(line);
    if (next && next[1].length <= heading) {
      break; // a sibling or parent heading ends the errors section
    }
    section.push(line);
  }
  return section.join('\n');
}
