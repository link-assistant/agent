"""Bounded Git reproduction of the Rust template's unchecked synchronization."""
from pathlib import Path
import subprocess
import tempfile


def git(cwd, *args):
    result = subprocess.run(['git', '-c', 'user.name=probe', '-c',
                             'user.email=probe@example.com', *args],
                            cwd=cwd, text=True, capture_output=True, check=True)
    return result.stdout.strip()


with tempfile.TemporaryDirectory(prefix='issue-340-template-') as temp:
    root = Path(temp)
    origin, seed, release, other = [root / name for name in ['origin.git', 'seed', 'release', 'other']]
    git(root, 'init', '-q', '--bare', '-b', 'main', str(origin))
    seed.mkdir()
    git(seed, 'init', '-q', '-b', 'main')
    (seed / 'Cargo.toml').write_text('[package]\nname="probe"\nversion="0.1.0"\n')
    git(seed, 'add', '.')
    git(seed, 'commit', '-qm', 'validated source')
    git(seed, 'remote', 'add', 'origin', str(origin))
    git(seed, 'push', '-q', 'origin', 'main')
    git(root, 'clone', '-q', str(origin), str(release))
    git(root, 'clone', '-q', str(origin), str(other))
    validated = git(release, 'rev-parse', 'HEAD')
    (other / 'src').mkdir()
    (other / 'src/lib.rs').write_text('pub fn untested() {}\n')
    git(other, 'add', '.')
    git(other, 'commit', '-qm', 'source landed after validation')
    git(other, 'push', '-q', 'origin', 'main')
    # Exact synchronization operations in version-and-commit.rs lines 525-545.
    git(release, 'fetch', 'origin', 'main')
    behind = int(git(release, 'rev-list', '--count', 'HEAD..origin/main'))
    if behind:
        git(release, 'rebase', 'origin/main')
    assert (release / 'src/lib.rs').exists()
    assert git(release, 'rev-parse', 'HEAD') != validated
    print('Reproduced: unchecked template synchronization adopted untested src/lib.rs.')
    print('No compiler, registry writes, tags or external Git writes were used.')
