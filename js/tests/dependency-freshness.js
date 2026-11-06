import { describe, expect, test } from 'bun:test';
import { npmFindings } from '../../scripts/check-npm-freshness.mjs';
import { cargoFreshness } from '../../scripts/check-cargo-freshness.mjs';

const outdated = { example: { current: '1.0.0', latest: '1.5.0' } };
const manifest = {
  dependencyPins: { example: 'https://github.com/example/example/issues/50' },
};
const issue =
  (data, status = 200) =>
  () =>
    Promise.resolve({
      ok: status === 200,
      status,
      json: () => Promise.resolve(data),
    });

describe('npm freshness regression', () => {
  test('a stale latest tag cannot fail an already-current install', async () => {
    expect(await npmFindings({}, outdated, () => '1.0.0', issue({}))).toEqual(
      []
    );
  });
  test('only an open issue permits a pin; a closed issue or pull request fails', async () => {
    expect(
      await npmFindings(
        manifest,
        outdated,
        () => '2.0.0',
        issue({ state: 'open' })
      )
    ).toEqual([]);
    for (const data of [
      { state: 'closed' },
      { state: 'open', pull_request: {} },
      {},
    ]) {
      expect(
        await npmFindings(manifest, outdated, () => '2.0.0', issue(data))
      ).toEqual([expect.stringContaining('pin issue is not open')]);
    }
    expect(await npmFindings({}, outdated, () => '2.0.0', issue({}))).toEqual([
      'example: 1.0.0 -> 2.0.0',
    ]);
  });
  test('registry/API errors stay errors rather than being downgraded to drift', async () => {
    await expect(
      npmFindings(manifest, outdated, () => '2.0.0', issue({}, 503))
    ).rejects.toThrow('verification unavailable');
    await expect(
      npmFindings({}, outdated, () => undefined, issue({}))
    ).rejects.toThrow('invalid latest');
  });
});

describe('cargo freshness regression', () => {
  test('main push tolerates external drift; schedules and manual checks enforce it', () => {
    const run = () => ({ status: 10, stdout: 'outdated crate' });
    expect(
      cargoFreshness(
        run,
        { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' },
        () => {}
      )
    ).toBe(0);
    expect(
      cargoFreshness(run, { GITHUB_EVENT_NAME: 'schedule' }, () => {})
    ).toBe(1);
    expect(
      cargoFreshness(run, { GITHUB_EVENT_NAME: 'workflow_dispatch' }, () => {})
    ).toBe(1);
  });
  test('tool failures and signals fail even on main', () => {
    for (const result of [
      { status: 1 },
      { status: null, signal: 'SIGTERM' },
      { error: new Error('missing tool') },
    ]) {
      expect(() =>
        cargoFreshness(
          () => result,
          { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' },
          () => {}
        )
      ).toThrow();
    }
    expect(
      cargoFreshness(
        () => ({ status: 0 }),
        {},
        () => {}
      )
    ).toBe(0);
  });
});
