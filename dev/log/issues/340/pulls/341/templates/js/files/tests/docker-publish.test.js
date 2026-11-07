import { describe, it, expect } from 'test-anywhere';
import { readFileSync } from 'node:fs';

import { evaluateDockerPublishConfig } from '../scripts/check-docker-publish.mjs';

const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8');
const dockerHubAction = readFileSync(
  '.github/actions/publish-dockerhub/action.yml',
  'utf8'
);

function getWorkflowJob(workflow, jobName) {
  const lines = workflow.replaceAll('\r\n', '\n').split('\n');
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  if (start === -1) {
    return '';
  }

  const nextJob = lines.findIndex(
    (line, index) => index > start && /^[ ]{2}[a-zA-Z0-9_-]+:\s*$/.test(line)
  );
  return lines.slice(start, nextJob === -1 ? lines.length : nextJob).join('\n');
}

function getActionSteps(workflow, action) {
  const lines = workflow.replaceAll('\r\n', '\n').split('\n');
  const steps = [];

  for (let index = 0; index < lines.length; index++) {
    if (lines[index].trim() !== `uses: ${action}`) {
      continue;
    }

    let start = index;
    while (start > 0 && !/^\s+- /.test(lines[start])) {
      start--;
    }

    let end = index + 1;
    while (end < lines.length && !/^\s+- /.test(lines[end])) {
      end++;
    }

    steps.push(lines.slice(start, end).join('\n'));
  }

  return steps;
}

function expectOrdered(text, markers) {
  let lastIndex = -1;

  for (const marker of markers) {
    const index = text.indexOf(marker);
    expect(index).toBeGreaterThan(lastIndex);
    lastIndex = index;
  }
}

describe('optional Docker Hub publishing workflow', () => {
  it('adds a Docker publish job downstream of npm release jobs', () => {
    const configJob = getWorkflowJob(releaseWorkflow, 'docker-publish-config');

    expect(configJob).toContain(
      'needs: [release, instant-release, release-preflight]'
    );
    expect(configJob).toContain('DOCKERHUB_IMAGE: ${{ vars.DOCKERHUB_IMAGE }}');
    expect(configJob).toContain(
      'DOCKERHUB_USERNAME: ${{ vars.DOCKERHUB_USERNAME }}'
    );
    expect(configJob).toContain(
      'DOCKERHUB_TOKEN: ${{ secrets.DOCKERHUB_TOKEN }}'
    );
    expect(configJob).toContain(
      'RELEASE_VERSION: ${{ needs.release.outputs.published_version || needs.instant-release.outputs.published_version }}'
    );
  });

  it('waits for the exact npm version before publishing Docker tags', () => {
    const configJob = getWorkflowJob(releaseWorkflow, 'docker-publish-config');
    const buildJob = getWorkflowJob(releaseWorkflow, 'docker-publish-build');
    const manifestJob = getWorkflowJob(releaseWorkflow, 'docker-publish');

    expectOrdered(configJob, [
      '- name: Check Docker publish configuration',
      '- name: Wait for npm package availability before Docker publish',
    ]);
    // The version reaches the script through the environment, keeping the
    // workflow expression out of the shell (zizmor template-injection).
    expect(configJob).toContain(
      'node scripts/wait-for-npm.mjs --release-version "${VERSION}"'
    );
    expect(buildJob).toContain('uses: ./.github/actions/publish-dockerhub');
    expect(manifestJob).toContain('docker buildx imagetools create');
    expect(manifestJob).toContain('--tag "${IMAGE}:latest"');
    expect(manifestJob).toContain('--tag "${IMAGE}:${VERSION}"');
    expect(manifestJob).toContain('"${#digests[@]}" -ne 2');
    expectOrdered(manifestJob, [
      '- name: Create multi-architecture manifest',
      '- name: Verify published multi-architecture manifests',
    ]);
    expect(manifestJob).toContain(
      'docker buildx imagetools inspect "${IMAGE}:${tag}"'
    );
    expect(manifestJob).toContain(
      'grep -Eq "Platform:[[:space:]]+${platform}"'
    );
    expect(manifestJob).toContain(
      'Published manifest ${IMAGE}:${tag} is missing ${platform}'
    );
    expect(manifestJob).toContain('for tag in latest "${VERSION}"');
    expect(dockerHubAction).toContain(
      'org.opencontainers.image.version=${{ inputs.version }}'
    );
    expect(dockerHubAction).toContain(
      'NPM_PACKAGE_VERSION=${{ inputs.version }}'
    );
  });

  it('uses Docker official GitHub Actions with DOCKERHUB_TOKEN authentication', () => {
    expect(dockerHubAction).toContain(
      'uses: ./.github/actions/setup-buildx-resilient'
    );
    expect(dockerHubAction).toContain('uses: docker/login-action@v4');
    expect(dockerHubAction).toContain('password: ${{ inputs.token }}');
    expect(dockerHubAction).toContain('uses: docker/metadata-action@v6');
    expect(dockerHubAction).toContain('uses: docker/build-push-action@v7');
  });

  it('builds amd64 and arm64 images concurrently on native runners', () => {
    const buildJob = getWorkflowJob(releaseWorkflow, 'docker-publish-build');

    expect(buildJob).toContain('platform: linux/amd64');
    expect(buildJob).toContain('runner: ubuntu-24.04');
    expect(buildJob).toContain('platform: linux/arm64');
    expect(buildJob).toContain('runner: ubuntu-24.04-arm');
    expect(buildJob).toContain('runs-on: ${{ matrix.runner }}');
    expect(dockerHubAction).toContain('platforms: ${{ inputs.platform }}');
    expect(dockerHubAction).toContain('push-by-digest=true');
    expect(releaseWorkflow).not.toContain('docker/setup-qemu-action');
  });

  it('checks artifact downloads without suppressing dependency deprecations', () => {
    const downloadSteps = getActionSteps(
      releaseWorkflow,
      './.github/actions/artifact-transport'
    ).filter((step) => step.includes('mode: download'));

    expect(downloadSteps.length).toBeGreaterThan(0);
    for (const step of downloadSteps) {
      expect(step).toContain(
        'NODE_OPTIONS: --pending-deprecation --throw-deprecation'
      );
    }
  });
});

describe('Docker publish configuration', () => {
  it('keeps Docker publishing disabled until DOCKERHUB_IMAGE is configured', () => {
    const config = evaluateDockerPublishConfig({
      env: {},
    });

    expect(config.enabled).toBe(false);
    expect(config.errors).toEqual([]);
  });

  it('reports missing Docker Hub credentials when publishing is enabled', () => {
    const config = evaluateDockerPublishConfig({
      cwd: '.',
      env: {
        DOCKERFILE: 'package.json',
        DOCKERHUB_IMAGE: 'owner/image',
      },
    });

    expect(config.enabled).toBe(false);
    expect(config.errors).toContain(
      'DOCKERHUB_USERNAME is required when DOCKERHUB_IMAGE is set'
    );
    expect(config.errors).toContain(
      'DOCKERHUB_TOKEN is required when DOCKERHUB_IMAGE is set'
    );
  });

  it('accepts complete Docker Hub configuration without exposing the token', () => {
    const config = evaluateDockerPublishConfig({
      cwd: '.',
      env: {
        DOCKER_CONTEXT: '.',
        DOCKERFILE: 'package.json',
        DOCKERHUB_IMAGE: 'owner/image',
        DOCKERHUB_TOKEN: 'secret-token',
        DOCKERHUB_USERNAME: 'owner',
      },
    });

    expect(config).toEqual({
      context: '.',
      dockerfile: 'package.json',
      enabled: true,
      errors: [],
      image: 'owner/image',
      username: 'owner',
    });
  });
});
