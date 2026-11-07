/** External drift is actionable on PRs/schedules, informational on main pushes. */
export function enforceFreshness(env = process.env) {
  return !(
    env.GITHUB_EVENT_NAME === 'push' && env.GITHUB_REF === 'refs/heads/main'
  );
}

export function reportFreshness(
  failures,
  env = process.env,
  log = console.error
) {
  if (failures.length === 0) {
    return 0;
  }
  const enforce = enforceFreshness(env);
  const message = failures.join('\n');
  log(
    `${enforce ? '::error::' : '::warning::'}Dependency freshness findings:\n${message}`
  );
  return enforce ? 1 : 0;
}
