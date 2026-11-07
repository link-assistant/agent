import { describe, it, expect } from 'test-anywhere';

import {
  removeAlwaysAuthEntries,
  sanitizeNpmUserConfig,
} from '../scripts/sanitize-npm-userconfig.mjs';

const quietLogger = {
  log() {},
  warn() {},
};

describe('npm user config sanitization', () => {
  it('removes only deprecated always-auth entries from npmrc content', () => {
    const result = removeAlwaysAuthEntries(
      [
        '//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}',
        'always-auth=true',
        'legacy-peer-deps=false',
        '',
      ].join('\n')
    );

    expect(result).toEqual({
      content: [
        '//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}',
        'legacy-peer-deps=false',
        '',
      ].join('\n'),
      removed: true,
    });
  });

  it('updates the user config file from NPM_CONFIG_USERCONFIG', () => {
    const userConfigPath = '/tmp/.npmrc';
    const files = new Map([
      [
        userConfigPath,
        [
          'always-auth=false',
          '//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}',
          '',
        ].join('\n'),
      ],
    ]);

    const result = sanitizeNpmUserConfig({
      env: { NPM_CONFIG_USERCONFIG: userConfigPath },
      fileExists: (path) => files.has(path),
      logger: quietLogger,
      readFile: (path) => files.get(path),
      writeFile: (path, content) => files.set(path, content),
    });

    expect(result).toEqual({
      path: userConfigPath,
      removed: true,
      skipped: false,
    });
    expect(files.get(userConfigPath)).toBe(
      ['//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}', ''].join('\n')
    );
  });

  it('skips cleanly when setup-node did not create a user config file', () => {
    const result = sanitizeNpmUserConfig({
      env: {},
      logger: quietLogger,
    });

    expect(result).toEqual({
      path: '',
      removed: false,
      skipped: true,
    });
  });
});
