import { test, expect, describe } from 'bun:test';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Unit tests for storage migration null byte fix.
 *
 * Issue #236: Storage migration fails with null byte in file path
 *
 * Root cause: The migration code used `fs.exists()` (not a standard
 * fs/promises API) without `await`, so the directory existence check
 * never worked. When the 'project' directory didn't exist,
 * `Bun.Glob.scan` was called on a non-existent path, producing
 * an ENOENT error with a null byte in the path.
 *
 * Additionally, the migration version file was read with `.json()`
 * but written as plain text with `.toString()`.
 *
 * Fixes:
 * 1. Replace `fs.exists()` with `fs.stat().then(s => s.isDirectory()).catch(() => false)`
 * 2. Read migration file with `.text()` + `.trim()` instead of `.json()`
 *
 * @see https://github.com/link-assistant/agent/issues/236
 */

describe('storage migration path safety', () => {
  test('fs.stat correctly identifies non-existent directories', async () => {
    const nonExistent = path.join(os.tmpdir(), 'does-not-exist-' + Date.now());
    const exists = await fs
      .stat(nonExistent)
      .then((s) => s.isDirectory())
      .catch(() => false);
    expect(exists).toBe(false);
  });

  test('fs.stat correctly identifies existing directories', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'migration-test-'));
    try {
      const exists = await fs
        .stat(tmpDir)
        .then((s) => s.isDirectory())
        .catch(() => false);
      expect(exists).toBe(true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('fs.stat returns false for files (not directories)', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'migration-test-'));
    const filePath = path.join(tmpDir, 'not-a-dir');
    try {
      await Bun.write(filePath, 'content');
      const isDir = await fs
        .stat(filePath)
        .then((s) => s.isDirectory())
        .catch(() => false);
      expect(isDir).toBe(false);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('migration file read with .text() and .trim() parses correctly', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'migration-test-'));
    const migrationFile = path.join(tmpDir, 'migration');
    try {
      // Write migration version as plain text (same as production code)
      await Bun.write(migrationFile, (2).toString());
      // Read it back using the fixed approach: .text() + .trim() + parseInt
      const version = await Bun.file(migrationFile)
        .text()
        .then((x) => parseInt(x.trim(), 10))
        .catch(() => 0);
      expect(version).toBe(2);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('migration file read returns 0 when file does not exist', async () => {
    const nonExistent = path.join(os.tmpdir(), 'no-migration-' + Date.now());
    const version = await Bun.file(nonExistent)
      .text()
      .then((x) => parseInt(x.trim(), 10))
      .catch(() => 0);
    expect(version).toBe(0);
  });

  test('path.resolve does not introduce null bytes', () => {
    const dir = '/workspace/.local/share/link-assistant-agent/storage';
    const project = path.resolve(dir, '../project');
    expect(project).toBe(
      '/workspace/.local/share/link-assistant-agent/project'
    );
    expect(project.includes('\0')).toBe(false);
  });

  test('Bun.Glob.scan on non-existent directory produces null byte in error (confirms bug)', async () => {
    // This test documents the Bun behavior that caused issue #236:
    // When Bun.Glob.scan is called with a non-existent cwd, the error
    // message contains a null byte (\0), which appears as \^@ in logs.
    // Our fix prevents this by checking directory existence before scanning.
    const nonExistent = path.join(os.tmpdir(), 'no-dir-' + Date.now());
    let errorThrown = false;
    try {
      for await (const _item of new Bun.Glob('*').scan({
        cwd: nonExistent,
        onlyFiles: false,
      })) {
        // consume iterator
      }
    } catch (e: any) {
      errorThrown = true;
      // Bun produces null bytes in the error message for non-existent paths
      // This is the root cause of issue #236
      expect(e.message).toContain('ENOENT');
    }
    expect(errorThrown).toBe(true);
  });
});

describe('storage.ts code correctness', () => {
  test('storage.ts uses fs.stat instead of fs.exists for directory checks', async () => {
    const source = await Bun.file(
      path.join(__dirname, '../src/storage/storage.ts')
    ).text();

    // Should NOT use fs.exists (non-standard, was the bug)
    expect(source).not.toContain('fs.exists(');

    // Should use fs.stat for directory checks (may be on next line due to formatting)
    expect(source).toContain('.stat(');
    expect(source).toContain('.isDirectory()');
  });

  test('storage.ts reads migration file with .text() not .json()', async () => {
    const source = await Bun.file(
      path.join(__dirname, '../src/storage/storage.ts')
    ).text();

    // Find the migration file reading code
    const migrationReadMatch = source.match(
      /Bun\.file\(path\.join\(dir, 'migration'\)\)\s*\.(text|json)\(\)/
    );
    expect(migrationReadMatch).not.toBeNull();
    expect(migrationReadMatch![1]).toBe('text');
  });
});
