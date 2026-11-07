import { describe, it, expect } from 'test-anywhere';
import { readFileSync } from 'node:fs';

import { evaluateDockerBuildConfig } from '../scripts/check-docker-build.mjs';

const releaseWorkflow = readFileSync(
  '.github/workflows/release.yml',
  'utf8'
).replaceAll('\r\n', '\n');

function getWorkflowJob(workflow, jobName) {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  if (start === -1) {
    return '';
  }

  const nextJob = lines.findIndex(
    (line, index) => index > start && /^[ ]{2}[a-zA-Z0-9_-]+:\s*$/.test(line)
  );
  return lines.slice(start, nextJob === -1 ? lines.length : nextJob).join('\n');
}

describe('pull-request Docker build check', () => {
  const dockerBuildJob = getWorkflowJob(releaseWorkflow, 'docker-build');

  it('runs on pull requests with code changes', () => {
    expect(dockerBuildJob).not.toBe('');
    expect(dockerBuildJob).toContain('needs: [detect-changes]');
    expect(dockerBuildJob).toContain(
      "if: github.event_name == 'pull_request' && needs.detect-changes.outputs.any-code-changed == 'true'"
    );
    expect(dockerBuildJob).toContain('timeout-minutes:');
  });

  it('builds without pushing so fork pull requests work without credentials', () => {
    expect(dockerBuildJob).toContain('uses: docker/build-push-action@v7');
    expect(dockerBuildJob).toContain('push: false');
    expect(dockerBuildJob).toContain('load: true');
    expect(dockerBuildJob).toContain('cache-from: type=gha,scope=docker-image');
    expect(dockerBuildJob).toContain(
      'cache-to: type=gha,mode=max,scope=docker-image'
    );
    expect(dockerBuildJob).not.toContain('DOCKERHUB_TOKEN');
  });

  it('scopes every gha cache exchange in the repository', () => {
    // Without a scope every build writes the same default `buildkit` cache
    // object, so concurrent builds overwrite each other and the mode=max
    // layer exports crowd the repository-wide 10 GB LRU pool.
    const sources = [
      releaseWorkflow,
      ...['links.yml', 'security.yml', 'workflows.yml', 'example-app.yml'].map(
        (name) => readFileSync(`.github/workflows/${name}`, 'utf8')
      ),
      readFileSync('.github/actions/publish-dockerhub/action.yml', 'utf8'),
    ];
    const unscoped = [];

    for (const [sourceIndex, source] of sources.entries()) {
      for (const match of source.matchAll(/cache-(?:from|to): *[^\n]*/g)) {
        if (/type=gha/.test(match[0]) && !/scope=/.test(match[0])) {
          unscoped.push(`source ${sourceIndex}: ${match[0].trim()}`);
        }
      }
    }

    expect(unscoped).toEqual([]);
  });

  it('builds the image before any release job runs', () => {
    // The publish job is gated on a successful release; the build check
    // must not be, otherwise a broken Dockerfile cannot fail a PR.
    const publishConfigJob = getWorkflowJob(
      releaseWorkflow,
      'docker-publish-config'
    );
    expect(publishConfigJob).toContain(
      'needs: [release, instant-release, release-preflight]'
    );
    expect(dockerBuildJob).not.toContain('release');
  });
});

describe('Docker build configuration', () => {
  it('stays disabled when the repository ships no Dockerfile', () => {
    const config = evaluateDockerBuildConfig({ cwd: '.', env: {} });

    expect(config.enabled).toBe(false);
    expect(config.errors).toEqual([]);
    expect(config.dockerfile).toBe('./Dockerfile');
    expect(config.context).toBe('.');
  });

  it('enables the build when a Dockerfile exists', () => {
    const config = evaluateDockerBuildConfig({
      cwd: '.',
      env: { DOCKERFILE: 'package.json', DOCKER_CONTEXT: '.' },
    });

    expect(config).toEqual({
      context: '.',
      dockerfile: 'package.json',
      enabled: true,
      errors: [],
    });
  });

  it('reports a missing build context', () => {
    const config = evaluateDockerBuildConfig({
      cwd: '.',
      env: { DOCKERFILE: 'package.json', DOCKER_CONTEXT: 'does-not-exist' },
    });

    expect(config.enabled).toBe(false);
    expect(config.errors).toEqual([
      'Docker context does not exist: does-not-exist',
    ]);
  });
});
