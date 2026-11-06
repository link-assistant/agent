// Reads a response body, failing as soon as it exceeds `max` bytes instead of
// buffering an oversized, chunked or endless body before checking its size
// (upstream 69f1ec22e3, #33259).
export async function readBounded(
  response: Response,
  max: number,
  tooLarge: () => Error
): Promise<Buffer> {
  const length = Number.parseInt(
    response.headers.get('content-length') ?? '',
    10
  );
  if (Number.isSafeInteger(length) && length > max) {
    await response.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, size);
}
