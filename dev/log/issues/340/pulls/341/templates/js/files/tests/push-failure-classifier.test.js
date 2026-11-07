import { describe, it, expect } from 'test-anywhere';

import {
  isBlockedByRepositoryRule,
  isNonFastForward,
} from '../scripts/push-failure-classifier.mjs';

// Verbatim git output for the two rejections that look alike but need
// opposite recoveries (link-foundation/js-ai-driven-development-pipeline-template#143).
const ruleViolation = {
  stdout: '',
  stderr: [
    'remote: error: GH013: Repository rule violations found for refs/heads/main.',
    'remote:',
    'remote: - Changes must be made through a pull request.',
    'remote:',
    'To https://github.com/link-foundation/js-ai-driven-development-pipeline-template',
    ' ! [remote rejected]   main -> main (push declined due to repository rule violations)',
    "error: failed to push some refs to 'https://github.com/link-foundation/js-ai-driven-development-pipeline-template'",
  ].join('\n'),
};

const lostRace = {
  stdout: '',
  stderr: [
    'To https://github.com/link-foundation/js-ai-driven-development-pipeline-template',
    ' ! [rejected]        main -> main (non-fast-forward)',
    "error: failed to push some refs to 'https://github.com/link-foundation/js-ai-driven-development-pipeline-template'",
    'hint: Updates were rejected because the tip of your current branch is behind',
  ].join('\n'),
};

describe('push failure classifier', () => {
  it('classifies a GH013 ruleset rejection as a repository rule violation', () => {
    expect(isBlockedByRepositoryRule(ruleViolation)).toBe(true);
  });

  it('never mistakes a ruleset rejection for a lost race', () => {
    // The GH013 output also contains "rejected"; rebasing can never satisfy a
    // rule, so treating it as a race is exactly the bug in the GH013 report in link-foundation/js-ai-driven-development-pipeline-template#143.
    expect(isNonFastForward(ruleViolation)).toBe(false);
  });

  it('classifies a non-fast-forward rejection as a lost race', () => {
    expect(isNonFastForward(lostRace)).toBe(true);
    expect(isBlockedByRepositoryRule(lostRace)).toBe(false);
  });

  it('recognizes legacy GH006 protected-branch rejections', () => {
    expect(
      isBlockedByRepositoryRule({
        stderr:
          'remote: error: GH006: Protected branch update failed for refs/heads/main.',
      })
    ).toBe(true);
  });

  it('reads the message of a thrown command error, not just its output', () => {
    expect(
      isBlockedByRepositoryRule(
        new Error(
          'Command failed (exit 1): git push origin HEAD:main\n' +
            'remote: - Changes must be made through a pull request.'
        )
      )
    ).toBe(true);
  });

  it('is case-insensitive and accepts a plain string', () => {
    expect(isBlockedByRepositoryRule('REPOSITORY RULE VIOLATIONS FOUND')).toBe(
      true
    );
    expect(isNonFastForward('Updates were rejected')).toBe(true);
  });

  it('treats other failures (auth, network) as neither', () => {
    const authFailure = {
      stderr:
        'remote: Invalid username or password.\nfatal: Authentication failed',
    };
    expect(isBlockedByRepositoryRule(authFailure)).toBe(false);
    expect(isNonFastForward(authFailure)).toBe(false);
  });
});
