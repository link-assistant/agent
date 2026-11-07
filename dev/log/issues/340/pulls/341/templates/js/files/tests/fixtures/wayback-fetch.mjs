// Offline CLI fixture. The first lookup is rate-limited in the recovery case.
let calls = 0;
globalThis.fetch = () => {
  calls++;
  if (process.env.WAYBACK_FIXTURE === 'persistent' || calls === 1) {
    return Promise.resolve({ ok: false, status: 429 });
  }
  return Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve({
        archived_snapshots: {
          closest: {
            available: true,
            url: 'http://web.archive.org/web/20240101000000/https://example.com/',
            timestamp: '20240101000000',
          },
        },
      }),
  });
};
