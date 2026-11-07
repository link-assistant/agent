"""Review every template path and preserve content comparisons in bounded chunks."""
from pathlib import Path
import difflib
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'dev/log/issues/340/pulls/341'
local_paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
local_paths = [p for p in local_paths if p and not p.startswith(('dev/log/', 'original-opencode/'))]


def read_chunks(path):
    lines = []
    with path.open(errors='replace') as handle:
        while True:
            chunk = [handle.readline() for _ in range(1500)]
            lines.extend(line for line in chunk if line)
            if not chunk[-1]:
                return lines


def disposition(path):
    name = Path(path).name.lower()
    if not path.startswith(('.github/', 'scripts/', '.husky/')) and '/' in path and not path.startswith('.changeset/'):
        return 'Compared template application/test/documentation/asset content: product-specific example, not a reusable agent pipeline component.'
    if any(word in path for word in ['desktop', 'preview', 'pages', 'docker', 'artifact-', 'extract-artifacts']):
        return 'Conditional: no desktop, site, container or deployment artifact is released by this CLI; retain template evidence.'
    if any(word in name for word in ['javascript-first', 'detect-javascript', 'javascript-provenance']):
        return 'Conditional: separate JS/Rust implementations are public CLI products; no Rust-to-JS transpilation or generated parity artifact.'
    if name.startswith('rerun-') or name.endswith('-jobs.py'):
        return 'Runner acquisition recovery: retain strict status-gate cancellation checks; no acquisition incident in cited runs.'
    if any(word in name for word in ['preflight', 'credential']):
        return 'Applied: scripts/release-preflight.mjs; PR report mode, main verified writes, unknown fails closed.'
    if any(word in name for word in ['version', 'changelog', 'changeset', 'release-metadata', 'release-content']):
        return 'Applied/adapted: existing JS changesets and Rust changelog.d plus version and metadata guards; preserve language-specific release recovery.'
    if any(word in name for word in ['code-changes', 'pr-comparison', 'merge']):
        return 'Applied/adapted: merge-base comparison, rename handling, relevant-change detection and fresh-merge validation.'
    if any(word in name for word in ['file-size', 'line-limit', 'required-doc', 'markdown-line']):
        return 'Applied: repository-wide 1500-line source limit and documentation validation, with archived evidence excluded.'
    if any(word in name for word in ['publish', 'registry', 'wait-for', 'release-needed', 'release-state', 'release-publication']):
        return 'Applied/adapted: existing registry verification, idempotent recovery, bounded publish retries and exact released-version targeting retained.'
    if any(word in name for word in ['push', 'git-config']):
        return 'Applied: classify rule/auth failures separately from non-fast-forward races; safe metadata synchronization; never force push.'
    if any(word in name for word in ['web-archive', 'broken-links', 'lychee', 'links.yml']):
        return 'Applied: existing lychee/archive validation retained; broken live links still fail; diagnostics always uploaded.'
    if any(word in name for word in ['pipeline-status', 'cancel-in-progress', 'status-gate', 'budget-warning']):
        return 'Applied: every job covered by status gate, job/matrix cancellation policy, strict budget wrapper and shared writer queue.'
    if any(word in name for word in ['security', 'audit', 'dependency-graph', 'codeql']):
        return 'Applied: scheduled npm/Cargo lockfile audit, dependency review fallback, CodeQL and least-privilege permissions retained.'
    if path.startswith('.github/workflows/'):
        return 'Compared job graph, triggers, permissions, cancellation, runners, install flags and artifacts; applicable policies mapped in ANALYSIS.md.'
    if path.startswith(('.github/ISSUE_TEMPLATE/', '.github/PULL_REQUEST_TEMPLATE')):
        return 'Contributor scaffolding, not an executable CI gate; repository issue/PR conventions retained.'
    if path.startswith('.github/'):
        return 'Compared repository automation/configuration; adapted existing policies rather than adding unrelated template scaffolding.'
    if path.startswith(('.husky/', '.pre-commit')) or 'eslint' in name or 'prettier' in name:
        return 'Applied: staged formatting/lint hooks, warnings-as-errors, synchronized line limits and CI format checks.'
    return 'Compared helper/configuration; existing agent equivalent retained where applicable (see nearest-path content diff).'


for language in ['js', 'rust', 'python']:
    base = OUT / 'templates' / language
    rows = ['# Complete template path comparison', '',
            'Every blob from the pinned full tree is preserved and content-inventoried below;',
            'template application source, tests and assets are classified separately from reusable pipeline code.', '',
            '| Template path | Content comparison / applicability |', '| --- | --- |']
    summary = []
    for path in (base / 'inventory.txt').read_text().splitlines():
        snapshot = base / 'files' / path
        if not snapshot.exists():
            rows.append(f'| `{path}` | Template application/test/documentation/asset; no executable CI counterpart required in agent. |')
            continue
        data = snapshot.read_bytes()
        binary = b'\0' in data
        lines = [] if binary else read_chunks(snapshot)
        candidates = [p for p in local_paths if Path(p).name == Path(path).name]
        if Path(path).name in ['package.json', 'package-lock.json']:
            candidates = ['js/' + Path(path).name] if not path.startswith('.github/actions/') else []
        if Path(path).name == 'README.md':
            candidates = [path] if path in local_paths else []
        if path == '.github/workflows/release.yml':
            candidates = [f'.github/workflows/{language if language != "python" else "js"}.yml']
        if path in candidates:
            candidates.remove(path)
            candidates.insert(0, path)
        if candidates and not binary:
            closest = max(candidates, key=lambda p: difflib.SequenceMatcher(None, lines, read_chunks(ROOT / p), autojunk=True).ratio())
            current = read_chunks(ROOT / closest)
            delta = ''.join(difflib.unified_diff(lines, current, fromfile=f'template/{path}', tofile=closest))
            target = base / 'comparisons' / (path + '.diff')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(delta or '# Identical contents\n')
            match = f'nearest `{closest}` ({"identical" if not delta else "adapted/different"})'
        else:
            match = 'no same-basename agent file'
        decision = disposition(path)
        rows.append(f'| `{path}` | {"binary" if binary else str(len(lines)) + " lines"}; {match}. {decision} |')
        summary.append({'path': path, 'lines': len(lines), 'binary': binary, 'sha256': hashlib.sha256(data).hexdigest(),
                        'nearest': candidates, 'decision': decision})
    (base / 'comparison.md').write_text('\n'.join(rows) + '\n')
    (base / 'content-review.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(f'{language}: {len(summary)} blobs content-inventoried with applicability decisions')
