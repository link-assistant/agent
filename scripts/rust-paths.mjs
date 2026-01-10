#!/usr/bin/env node

/**
 * Rust package path detection utility
 *
 * Automatically detects the Rust package root for both:
 * - Single-language repositories (Cargo.toml in root)
 * - Multi-language repositories (Cargo.toml in rust/ subfolder)
 *
 * Usage:
 *   import { getRustRoot, getCargoTomlPath, getChangelogDir } from './rust-paths.mjs';
 *
 *   const rustRoot = getRustRoot();          // Returns 'rust' or '.'
 *   const cargoPath = getCargoTomlPath();    // Returns 'rust/Cargo.toml' or './Cargo.toml'
 */

import { existsSync } from 'fs';
import { join } from 'path';

// Cache for detected paths (computed once per process)
let cachedRustRoot = null;

/**
 * Detect Rust package root directory
 * Checks in order:
 * 1. ./Cargo.toml (single-language repo)
 * 2. ./rust/Cargo.toml (multi-language repo)
 *
 * @param {Object} options - Configuration options
 * @param {string} [options.rustRoot] - Explicitly set Rust root (overrides auto-detection)
 * @param {boolean} [options.verbose=false] - Log detection details
 * @returns {string} The Rust root directory ('.' or 'rust')
 * @throws {Error} If no Cargo.toml is found in expected locations
 */
export function getRustRoot(options = {}) {
  const { rustRoot: explicitRoot, verbose = false } = options;

  // If explicitly configured, use that
  if (explicitRoot !== undefined) {
    if (verbose) {
      console.log(`Using explicitly configured Rust root: ${explicitRoot}`);
    }
    return explicitRoot;
  }

  // Return cached value if already computed
  if (cachedRustRoot !== null) {
    return cachedRustRoot;
  }

  // Check for single-language repo (Cargo.toml in root)
  if (existsSync('./Cargo.toml')) {
    if (verbose) {
      console.log('Detected single-language repository (Cargo.toml in root)');
    }
    cachedRustRoot = '.';
    return cachedRustRoot;
  }

  // Check for multi-language repo (Cargo.toml in rust/ subfolder)
  if (existsSync('./rust/Cargo.toml')) {
    if (verbose) {
      console.log('Detected multi-language repository (Cargo.toml in rust/)');
    }
    cachedRustRoot = 'rust';
    return cachedRustRoot;
  }

  // No Cargo.toml found
  throw new Error(
    'Could not find Cargo.toml in expected locations.\n' +
    'Searched in:\n' +
    '  - ./Cargo.toml (single-language repository)\n' +
    '  - ./rust/Cargo.toml (multi-language repository)\n\n' +
    'To fix this, either:\n' +
    '  1. Run the script from the repository root\n' +
    '  2. Explicitly configure the Rust root using --rust-root option\n' +
    '  3. Set the RUST_ROOT environment variable'
  );
}

/**
 * Get the path to Cargo.toml
 * @param {Object} options - Configuration options (passed to getRustRoot)
 * @returns {string} Path to Cargo.toml
 */
export function getCargoTomlPath(options = {}) {
  const rustRoot = getRustRoot(options);
  return rustRoot === '.' ? './Cargo.toml' : join(rustRoot, 'Cargo.toml');
}

/**
 * Get the path to Cargo.lock
 * @param {Object} options - Configuration options (passed to getRustRoot)
 * @returns {string} Path to Cargo.lock
 */
export function getCargoLockPath(options = {}) {
  const rustRoot = getRustRoot(options);
  return rustRoot === '.' ? './Cargo.lock' : join(rustRoot, 'Cargo.lock');
}

/**
 * Get the path to changelog.d directory
 * @param {Object} options - Configuration options (passed to getRustRoot)
 * @returns {string} Path to changelog.d directory
 */
export function getChangelogDir(options = {}) {
  const rustRoot = getRustRoot(options);
  return rustRoot === '.' ? './changelog.d' : join(rustRoot, 'changelog.d');
}

/**
 * Get the path to CHANGELOG.md
 * @param {Object} options - Configuration options (passed to getRustRoot)
 * @returns {string} Path to CHANGELOG.md
 */
export function getChangelogPath(options = {}) {
  const rustRoot = getRustRoot(options);
  return rustRoot === '.' ? './CHANGELOG.md' : join(rustRoot, 'CHANGELOG.md');
}

/**
 * Get the cd command prefix for running cargo commands
 * Returns empty string for single-language repos, 'cd rust && ' for multi-language repos
 * @param {Object} options - Configuration options (passed to getRustRoot)
 * @returns {string} CD prefix for shell commands
 */
export function getCdPrefix(options = {}) {
  const rustRoot = getRustRoot(options);
  return rustRoot === '.' ? '' : `cd ${rustRoot} && `;
}

/**
 * Check if we need to change directory before running cargo commands
 * @param {Object} options - Configuration options (passed to getRustRoot)
 * @returns {boolean} True if cd is needed
 */
export function needsCd(options = {}) {
  const rustRoot = getRustRoot(options);
  return rustRoot !== '.';
}

/**
 * Reset the cached Rust root (useful for testing)
 */
export function resetCache() {
  cachedRustRoot = null;
}

/**
 * Parse Rust root from CLI arguments or environment
 * Supports --rust-root argument and RUST_ROOT environment variable
 * @returns {string|undefined} Configured Rust root or undefined for auto-detection
 */
export function parseRustRootConfig() {
  // Check CLI arguments
  const args = process.argv.slice(2);
  const rustRootIndex = args.indexOf('--rust-root');
  if (rustRootIndex >= 0 && args[rustRootIndex + 1]) {
    return args[rustRootIndex + 1];
  }

  // Check environment variable
  if (process.env.RUST_ROOT) {
    return process.env.RUST_ROOT;
  }

  return undefined;
}
