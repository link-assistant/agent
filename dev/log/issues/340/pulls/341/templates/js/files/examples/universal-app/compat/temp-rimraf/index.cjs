const { rm, rmSync } = require('node:fs');

// temp 0.9.4 passes literal paths and this single retry option. Reject other
// options so a future consumer cannot silently depend on unsupported globbing.
function optionsFor(options = {}) {
  if (Object.keys(options).some((key) => key !== 'maxBusyTries')) {
    throw new TypeError('Unsupported temp cleanup option');
  }
  const retries = options.maxBusyTries ?? 3;
  if (!Number.isSafeInteger(retries) || retries < 0) {
    throw new TypeError('Invalid temp cleanup retry count');
  }
  return { recursive: true, force: true, maxRetries: retries, retryDelay: 100 };
}

function remove(target, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  rm(target, optionsFor(options), callback);
}

remove.sync = (target, options) => rmSync(target, optionsFor(options));
module.exports = remove;
