"""Collect bounded, reproducible GitHub evidence without checking out templates."""

import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'dev/log/issues/340/pulls/341'
REPO = 'link-assistant/agent'
RUNS = [42306243946, 42306244000, 42306244023, 42306243941,
        42306243945, 42306243969, 42306243966, 42239835585]


def gh_to(path, *args):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w') as output:
        result = subprocess.run(['gh', *args], stdout=output, stderr=subprocess.PIPE)
    if result.returncode:
        path.with_suffix(path.suffix + '.error.txt').write_bytes(result.stderr)
        print(f'Unavailable: {path.name}: {result.stderr.decode().strip()}', flush=True)
    return result.returncode == 0


for run in RUNS:
    print(f'Collecting run {run}', flush=True)
    gh_to(OUT / f'meta/run-{run}.json', 'api', f'repos/{REPO}/actions/runs/{run}')
    gh_to(OUT / f'meta/jobs-{run}.json', 'api', f'repos/{REPO}/actions/runs/{run}/jobs', '--paginate')
    gh_to(OUT / f'meta/artifacts-{run}.json', 'api', f'repos/{REPO}/actions/runs/{run}/artifacts', '--paginate')
    gh_to(OUT / f'ci-logs/run-{run}.log', 'run', 'view', str(run), '--repo', REPO, '--log')

for language in ['js', 'rust', 'python']:
    repo = f'link-foundation/{language}-ai-driven-development-pipeline-template'
    base = OUT / 'templates' / language
    gh_to(base / 'repository.json', 'api', f'repos/{repo}')
    branch = json.loads((base / 'repository.json').read_text())['default_branch']
    gh_to(base / 'commit.json', 'api', f'repos/{repo}/commits/{branch}')
    sha = json.loads((base / 'commit.json').read_text())['sha']
    gh_to(base / 'tree.json', 'api', f'repos/{repo}/git/trees/{sha}?recursive=1')
    tree = json.loads((base / 'tree.json').read_text())
    if tree.get('truncated'):
        raise RuntimeError(f'Truncated template tree: {repo}')
    paths = [item['path'] for item in tree['tree'] if item['type'] == 'blob']
    (base / 'inventory.txt').write_text('\n'.join(paths) + '\n')
    selected = [p for p in paths if p.startswith(('.github/', 'scripts/', '.husky/'))
                or p in ['package.json', 'eslint.config.mjs', '.prettierrc',
                         '.prettierignore', 'Cargo.toml', 'pyproject.toml',
                         '.pre-commit-config.yaml', 'rust-toolchain.toml']]
    for path in selected:
        gh_to(base / 'files' / path, 'api', f'repos/{repo}/contents/{path}?ref={sha}',
              '-H', 'Accept: application/vnd.github.raw+json')
    print(f'{language}: {len(paths)} files inventoried; {len(selected)} CI files collected at {sha}', flush=True)
