export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeout: NodeJS.Timeout;
  return Promise.race([
    // Clear the timer on rejection too, so a failed call does not keep the
    // timer and its closure alive until the deadline (issue #335).
    promise.finally(() => clearTimeout(timeout)),
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(`Operation timed out after ${ms}ms`));
      }, ms);
      // Prevent timeout from keeping the event loop alive (#213)
      timeout.unref();
    }),
  ]);
}
