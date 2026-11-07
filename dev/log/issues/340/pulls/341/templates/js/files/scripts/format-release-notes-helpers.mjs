import { URL } from 'node:url';
import { normalizeReleaseVersion } from './release-naming.mjs';
import { markdownLines } from './markdown-lines.mjs';

export function normalizeReleaseVersionForBadge(releaseVersion) {
  return normalizeReleaseVersion(releaseVersion);
}

export function encodeShieldsStaticBadgeSegment(value) {
  return encodeURIComponent(value).replace(/-/g, '--').replace(/_/g, '__');
}

export function buildNpmVersionBadge(packageName, releaseVersion) {
  const versionWithoutV = normalizeReleaseVersionForBadge(releaseVersion);
  const badgeVersion = encodeShieldsStaticBadgeSegment(versionWithoutV);
  const packageVersionPath = encodeURIComponent(versionWithoutV);

  return `[![npm version](https://img.shields.io/badge/npm-${badgeVersion}-blue.svg)](https://www.npmjs.com/package/${packageName}/v/${packageVersionPath})`;
}

/** Recognize a generated npm badge image, not an arbitrary hostname mention. */
export function hasGeneratedNpmBadge(body) {
  const prose = markdownLines(body)
    .filter((line) => !line.code)
    .map((line) => line.raw)
    .join('');
  const destinations = prose.matchAll(
    /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g
  );
  for (const match of destinations) {
    try {
      const url = new URL(match[1] || match[2]);
      if (
        url.protocol === 'https:' &&
        url.hostname === 'img.shields.io' &&
        !url.username &&
        !url.password &&
        !url.port &&
        url.pathname.startsWith('/badge/npm-')
      ) {
        return true;
      }
    } catch {
      /* Invalid image destinations are ordinary unformatted notes. */
    }
  }
  return false;
}

const CHANGE_SECTION = /^ {0,3}### (Major|Minor|Patch) Changes[ \t]*$/;
const ENTRY_HASH = /^ {0,3}[-*][ \t]+([a-f0-9]{7,40}):/;

/**
 * Remove trailing whitespace and extra blank lines and keep everything else,
 * so multi-paragraph entries, nested lists and rules stay inside their item.
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeMarkdown(text) {
  let blank = false;
  return markdownLines(text)
    .map((line) => {
      if (line.code) {
        blank = false;
        return line.raw;
      }
      const value = line.text.replace(/[ \t]+$/, '');
      if (!value && blank) {
        return '';
      }
      blank = !value;
      return value + (line.raw.endsWith('\n') ? '\n' : '');
    })
    .join('')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}

/**
 * Take the change sections out of a changelog-derived release body. A body
 * with one section gives that section's list as written; several keep their
 * headings. The body travels as JSON, so no shell escaping needs undoing.
 *
 * @param {string} body
 * @returns {{ description: string, commitHashes: string[] } | null}
 *   null when the body has no `### Major|Minor|Patch Changes` section
 */
export function buildReleaseDescription(body) {
  const text = String(body || '');
  const lines = markdownLines(text);
  const headings = lines.filter(
    (line) => !line.code && CHANGE_SECTION.test(line.text)
  );
  if (headings.length === 0) {
    return null;
  }
  const sections = headings
    .map((match, index) => ({
      type: match.text.match(CHANGE_SECTION)[1],
      content: normalizeMarkdown(
        text.slice(match.end, headings[index + 1]?.start ?? text.length)
      ),
    }))
    .filter((section) => section.content);
  const description =
    sections.length === 1
      ? sections[0].content
      : sections
          .map(({ type, content }) => `### ${type} Changes\n\n${content}`)
          .join('\n\n');
  const commitHashes = [
    ...new Set(
      lines
        .filter((line) => !line.code)
        .flatMap((line) => line.text.match(ENTRY_HASH)?.[1] ?? [])
    ),
  ];
  return { description, commitHashes };
}
