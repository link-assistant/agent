/** The footer written by format-release-notes.mjs. */
export function npmVersionBadge(packageName, version) {
  return `[![npm version](https://img.shields.io/badge/npm-${version}-blue.svg)](https://www.npmjs.com/package/${packageName}/v/${version})`;
}

export function hasFormattedNpmBadge(body, badge) {
  return body.trimEnd().endsWith(`\n\n---\n\n${badge}`);
}
