#!/usr/bin/env node

/**
 * Check for files exceeding the maximum allowed line count
 * Exits with error code 1 if any files exceed the limit
 */

import { readdir, readFile } from 'fs/promises';
import { join, relative } from 'path';

const MAX_LINES = 1000;
const FILE_EXTENSIONS = ['.js', '.mjs', '.cjs'];

/**
 * Recursively find all JavaScript files in a directory
 * @param {string} dir - Directory to search
 * @param {string[]} filesToExclude - Patterns to exclude
 * @returns {Promise<string[]>} Array of file paths
 */
async function findJavaScriptFiles(dir, filesToExclude = []) {
  const files = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relativePath = relative(process.cwd(), fullPath);

    // Skip excluded directories and files
    if (
      filesToExclude.some((pattern) =>
        relativePath.includes(pattern.replace(/\*\*/g, ''))
      )
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...(await findJavaScriptFiles(fullPath, filesToExclude)));
    } else if (FILE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Count lines in a file
 * @param {string} filePath - Path to the file
 * @returns {Promise<number>} Number of lines
 */
async function countLines(filePath) {
  const content = await readFile(filePath, 'utf-8');
  return content.split('\n').length;
}

/**
 * Main function
 */
async function main() {
  const excludePatterns = ['node_modules', 'coverage', 'dist', '.git', 'build'];

  console.log(
    `\nChecking JavaScript files for maximum ${MAX_LINES} lines...\n`
  );

  const files = await findJavaScriptFiles(process.cwd(), excludePatterns);
  const violations = [];

  for (const file of files) {
    const lineCount = await countLines(file);
    if (lineCount > MAX_LINES) {
      violations.push({
        file: relative(process.cwd(), file),
        lines: lineCount,
      });
    }
  }

  if (violations.length === 0) {
    console.log('✓ All files are within the line limit\n');
    process.exit(0);
  } else {
    console.error('✗ Found files exceeding the line limit:\n');
    for (const violation of violations) {
      console.error(
        `  ${violation.file}: ${violation.lines} lines (exceeds ${MAX_LINES})`
      );
    }
    console.error(
      `\nPlease refactor these files to be under ${MAX_LINES} lines\n`
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Error:', error.message);
  if (process.env.DEBUG) {
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
});
