#!/usr/bin/env python3
"""Exercise both release CLIs against a local registry; origins are local only."""
import http.server
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]


class RegistryRegressions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.requests = []
        cls.mode = 'success'
        cls.scope = ''
        cls.maximum = '1.2.3'

        class Registry(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                cls.requests.append(self.path)
                affected = cls.scope in self.path
                if affected and (cls.mode == 'drop' or (cls.mode == 'drop-once' and len(cls.requests) == 2)):
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.connection.close()
                    return
                if affected and cls.mode in ['429', '503', '403', '404']:
                    status, data = int(cls.mode), {}
                elif affected and cls.mode == 'malformed':
                    status, data = 200, {}
                else:
                    status = 200
                    if self.path.endswith('/fixture'):
                        data = {'versions': [{'num': cls.maximum, 'yanked': False}]}
                    elif '/releases/tags/' in self.path:
                        data = {'tag_name': self.path.rsplit('/', 1)[1]}
                    elif '/tags/' in self.path:
                        data = {'name': self.path.rsplit('/', 1)[1]}
                    elif self.path.endswith('/1.2.3'):
                        data = {'version': {'num': '1.2.3'}}
                    else:
                        status, data = 404, {}
                body = json.dumps(data).encode()
                self.send_response(status)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Registry)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.temp = tempfile.TemporaryDirectory(prefix='registry-scripts-')
        cls.scripts = Path(cls.temp.name) / 'scripts'
        shutil.copytree(ROOT / 'scripts', cls.scripts)
        address = f'http://127.0.0.1:{cls.server.server_port}'
        for path in cls.scripts.rglob('*.rs'):
            source = path.read_text()
            for url in ['https://crates.io', 'https://api.github.com', 'https://hub.docker.com']:
                source = source.replace(url, address)
            source = source.replace('Duration::from_secs(1)', 'Duration::ZERO')
            path.write_text(source)
        cls.env = {**os.environ, 'RUST_LOG': 'error'}
        cls.rust_script = shutil.which('rust-script')
        for script in ['check-release-needed.rs', 'version-and-commit.rs']:
            result = subprocess.run([cls.rust_script, '--wrapper', 'true', str(cls.scripts / script)],
                                    env=cls.env, capture_output=True, text=True)
            if result.returncode:
                raise RuntimeError(result.stdout + result.stderr)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def setUp(self):
        self.__class__.requests = []
        self.__class__.mode = 'success'
        self.__class__.scope = ''
        self.__class__.maximum = '1.2.3'
        temp = tempfile.TemporaryDirectory(prefix='registry-cli-')
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        self.work = root / 'work'
        self.work.mkdir()
        self.output = root / 'outputs'
        self.env = {**self.__class__.env, 'GITHUB_OUTPUT': str(self.output),
                    'GITHUB_REPOSITORY': 'fixture/repo', 'HAS_FRAGMENTS': 'false'}
        for key in ['RUST_ROOT', 'GITHUB_TOKEN', 'DOCKERHUB_IMAGE']:
            self.env.pop(key, None)
        (self.work / 'Cargo.toml').write_text('[package]\nname="fixture"\nversion="1.2.3"\n')
        (self.work / 'src').mkdir()
        (self.work / 'src/lib.rs').write_text('pub fn fixture() {}\n')
        (self.work / 'CHANGELOG.md').write_text('## [1.2.3]\n\nOriginal notes.\n')
        self.git('init', '-q', '-b', 'main')
        self.git('config', 'user.name', 'Fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.git('add', '.')
        self.git('commit', '-qm', 'fixture')
        origin = root / 'origin.git'
        subprocess.run(['git', 'init', '--bare', '-q', str(origin)], check=True)
        self.git('remote', 'add', 'origin', str(origin))
        self.git('push', '-q', '-u', 'origin', 'main')

    def git(self, *args):
        return subprocess.run(['git', *args], cwd=self.work, capture_output=True, text=True, check=True).stdout

    def script(self, name):
        args = ['--bump-type', 'patch'] if name == 'version-and-commit.rs' else []
        return subprocess.run([self.rust_script, str(self.scripts / name), *args], cwd=self.work,
                              env=self.env, capture_output=True, text=True, timeout=40)

    def test_failed_lookup_never_decides_release_or_mutates_version(self):
        for mode in ['503', '429', '403', 'malformed', 'drop']:
            for script in ['check-release-needed.rs', 'version-and-commit.rs']:
                with self.subTest(mode=mode, script=script):
                    self.__class__.mode = mode
                    self.__class__.requests = []
                    self.output.unlink(missing_ok=True)
                    before = (self.work / 'Cargo.toml').read_bytes()
                    result = self.script(script)
                    self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertNotIn('should_release=true', self.output.read_text() if self.output.exists() else '')
                    self.assertEqual((self.work / 'Cargo.toml').read_bytes(), before)
                    self.assertEqual(self.git('status', '--porcelain'), '')

    def test_individual_artifact_and_candidate_lookup_failures_stop_the_clis(self):
        (self.work / 'Dockerfile').write_text('FROM scratch\n')
        self.git('add', 'Dockerfile')
        self.git('commit', '-qm', 'Docker fixture')
        self.git('push', '-q')
        self.env['DOCKERHUB_IMAGE'] = 'fixture/image'
        for scope, scripts in [('/crates/fixture/', ['check-release-needed.rs', 'version-and-commit.rs']),
                               ('/repos/', ['check-release-needed.rs']),
                               ('/tags/', ['check-release-needed.rs'])]:
            for mode in ['503', '429', '403', 'malformed', 'drop']:
                for script in scripts:
                    with self.subTest(scope=scope, mode=mode, script=script):
                        self.__class__.scope = scope
                        self.__class__.mode = mode
                        self.output.unlink(missing_ok=True)
                        result = self.script(script)
                        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                        self.assertNotIn('should_release=true', self.output.read_text() if self.output.exists() else '')
                        self.assertIn('version="1.2.3"', (self.work / 'Cargo.toml').read_text())
                        self.assertEqual(self.git('status', '--porcelain'), '')

    def test_writer_uses_highest_published_version_as_its_floor(self):
        self.__class__.maximum = '2.4.9'
        result = self.script('version-and-commit.rs')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('version="2.4.10"', (self.work / 'Cargo.toml').read_text())
        self.assertTrue(any(path.endswith('/2.4.10') for path in self.requests))
        self.assertEqual(self.git('status', '--porcelain'), '')

    def test_dropped_version_request_recovers_without_rerelease(self):
        self.__class__.mode = 'drop-once'
        result = self.script('check-release-needed.rs')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('should_release=false', self.output.read_text())
        self.assertGreaterEqual(len(self.requests), 4)

    def test_only_not_found_makes_a_missing_artifact_decision(self):
        self.__class__.mode = '404'
        result = self.script('check-release-needed.rs')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('should_release=true', self.output.read_text())
        self.assertIn('skip_bump=true', self.output.read_text())


if __name__ == '__main__':
    unittest.main()
