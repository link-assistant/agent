import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkCratePublisher, publishProbeBody } from './crates-publish-preflight.mjs';

test('publish body has valid metadata and no archive length or archive bytes', () => {
  const body = publishProbeBody('fixture');
  const length = body.readUInt32LE();
  assert.equal(body.length, 4 + length);
  assert.deepEqual(JSON.parse(body.subarray(4).toString()), { name: 'fixture', vers: '0.0.0-preflight' });
});

test('only the exact missing tarball response proves scoped API credentials', async () => {
  const result = await checkCratePublisher({ packageName: 'fixture', token: 'mock-credential',
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://crates.io/api/v1/crates/new');
      assert.equal(options.method, 'PUT');
      assert.equal(options.headers.authorization, 'mock-credential');
      assert.equal(options.body.length, 4 + options.body.readUInt32LE());
      return { status: 400, json: async () => ({ errors: [{ detail: 'invalid tarball length' }] }) };
    } });
  assert.equal(result.verdict, 'verified');
});

for (const [status, verdict] of [[200, 'unknown'], [401, 'denied'], [403, 'denied'],
  [404, 'unknown'], [429, 'unknown'], [500, 'unknown'], [503, 'unknown']]) {
  test(`HTTP ${status} cannot pass credential preflight`, async () => {
    const result = await checkCratePublisher({ packageName: 'fixture', token: 'mock-credential',
      fetchImpl: async () => ({ status }) });
    assert.equal(result.verdict, verdict);
    assert.ok(!result.message.includes('mock-credential'));
  });
}

for (const errors of [[{ detail: 'invalid metadata length' }],
  [{ detail: 'invalid tarball length for remaining payload' }], [],
  [{ detail: 'invalid tarball length' }, { detail: 'denied' }]]) {
  test(`an unrelated HTTP 400 is unverified: ${JSON.stringify(errors)}`, async () => {
    const result = await checkCratePublisher({ packageName: 'fixture', token: 'mock-credential',
      fetchImpl: async () => ({ status: 400, json: async () => ({ errors }) }) });
    assert.equal(result.verdict, 'unknown');
  });
}

test('network and malformed JSON errors stay unknown without leaking secrets', async () => {
  for (const fetchImpl of [async () => { throw new Error('mock-credential'); },
    async () => ({ status: 400, json: async () => { throw new Error('mock-credential'); } })]) {
    const result = await checkCratePublisher({ packageName: 'fixture', token: 'mock-credential', fetchImpl });
    assert.equal(result.verdict, 'unknown');
    assert.ok(!result.message.includes('mock-credential'));
  }
});
