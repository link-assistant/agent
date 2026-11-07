"""Preserve completed PR runs and all job/diagnostic artifact evidence."""
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'dev/log/issues/340/pulls/341'
REPO = 'link-assistant/agent'
BRANCH = 'issue-340-8f7dd340a8ef'


def capture(destination, *args):
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open('w') as handle:
        subprocess.run(['gh', *args], cwd=ROOT, stdout=handle, check=True)


capture(OUT / 'meta/pr-runs.jsonl', 'api', f'repos/{REPO}/actions/runs?branch={BRANCH}&per_page=100', '--paginate')
data = (OUT / 'meta/pr-runs.jsonl').read_text()
decoder = json.JSONDecoder()
runs = []
while data.strip():
    page, offset = decoder.raw_decode(data.lstrip())
    runs.extend(page['workflow_runs'])
    data = data.lstrip()[offset:]
for run in runs:
    identifier = run['id']
    if run['status'] != 'completed':
        print(f'{identifier}: still {run["status"]}', flush=True)
        continue
    (OUT / f'meta/run-{identifier}.json').write_text(json.dumps(run, indent=2) + '\n')
    for endpoint in ['jobs', 'artifacts']:
        capture(OUT / f'meta/{endpoint}-{identifier}.json', 'api', f'repos/{REPO}/actions/runs/{identifier}/{endpoint}', '--paginate')
    log = OUT / f'ci-logs/run-{identifier}.log'
    if not log.exists() or not log.stat().st_size:
        capture(log, 'run', 'view', str(identifier), '--repo', REPO, '--log')
    artifact_data = json.loads((OUT / f'meta/artifacts-{identifier}.json').read_text())
    for artifact in artifact_data['artifacts']:
        if any(word in artifact['name'] for word in ['drift', 'link', 'diagnostic']):
            target = OUT / f'artifacts/{identifier}/{artifact["name"]}'
            if not target.exists():
                subprocess.run(['gh', 'run', 'download', str(identifier), '--repo', REPO,
                                '--name', artifact['name'], '--dir', str(target)], check=True)
    print(f'{identifier}: {run["name"]} {run["conclusion"]}', flush=True)
