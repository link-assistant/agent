// All supported runtimes provide DOMException; preserve node-domexception's
// CommonJS default constructor contract without loading a deprecated polyfill.
module.exports = globalThis.DOMException;
