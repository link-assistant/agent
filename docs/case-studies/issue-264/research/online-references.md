# Online References

Only official or primary documentation was used for the online research.

## GitHub Actions And Forked Pull Requests

- GitHub Actions events documentation:
  <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows>

  Relevant points: fork pull request workflows have special token/secrets
  behavior, and for fork PRs GitHub sends pull request events to the base
  repository. The same page documents that `pull_request_target` runs with the
  base repository as the event context.

- GitHub `GITHUB_TOKEN` authentication documentation:
  <https://docs.github.com/en/actions/tutorials/authenticate-with-github_token>

  Relevant points: workflows should explicitly set least-privilege
  `permissions`, and a GitHub App or secret token is required when
  `GITHUB_TOKEN` cannot provide the needed permission.

## Checking Out And Updating Pull Request Branches

- GitHub CLI `gh pr checkout` manual:
  <https://cli.github.com/manual/gh_pr_checkout>

  Relevant point: `gh pr checkout` can check out pull requests, including PRs
  from forks, by number, URL, or branch.

- GitHub Docs for checking out pull requests locally:
  <https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/checking-out-pull-requests-locally?platform=linux>

  Relevant points: GitHub stores PR changes remotely, and maintainers need
  appropriate push access or maintainer permission to update a fork PR branch.

- Git `push` documentation:
  <https://git-scm.com/docs/git-push>

  Relevant points: normal branch pushes must be fast-forward updates; rejected
  and remote-rejected push outcomes have different meanings; non-fast-forward
  updates should be handled by fetching and integrating remote work, or by using
  force only with explicit intent and safeguards such as `--force-with-lease`.

## AI SDK Stream Error Handling

- AI SDK Core error handling documentation:
  <https://ai-sdk.dev/docs/ai-sdk-core/error-handling>

  Relevant point: full streams can include error parts, and stream processing
  should also use `try/catch` because errors can be thrown outside normal stream
  parts.

- AI SDK `streamText` reference:
  <https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text>

  Relevant points: `fullStream` contains all stream events, including errors,
  and usage fields such as `inputTokens`, `outputTokens`, and `totalTokens` can
  be undefined depending on provider data.
