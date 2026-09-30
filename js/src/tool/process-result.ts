/** Keep process status in the text sent to every provider, including those
 * whose tool protocol has no separate error flag. */
export function processResult(input: {
  output: string;
  exit: number | null;
  signal?: string | null;
  timedOut?: boolean;
  aborted?: boolean;
}) {
  const isError = input.exit !== 0 || !!input.timedOut || !!input.aborted;
  const status = input.signal ? ` (signal ${input.signal})` : '';
  return {
    output: isError
      ? `Exit code ${input.exit ?? 'unavailable'}${status}\n${input.output}`
      : input.output,
    isError,
  };
}
