"""Inspect current direct Rust dependency releases from crates.io."""

import concurrent.futures
import json
import pathlib
import re
import sys
import tomllib
import urllib.request


ROOT = pathlib.Path(__file__).resolve().parents[2]
manifest = tomllib.loads((ROOT / "rust/Cargo.toml").read_text())
dependencies = {**manifest["dependencies"], **manifest["dev-dependencies"]}


def latest(item):
    name, declaration = item
    current = declaration if isinstance(declaration, str) else declaration["version"]
    request = urllib.request.Request(
        f"https://crates.io/api/v1/crates/{name}",
        headers={"User-Agent": "link-assistant/agent issue-319 dependency check"},
    )
    with urllib.request.urlopen(request) as response:
        crate = json.load(response)["crate"]
    return name, current, crate["max_stable_version"]


with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    releases = sorted(pool.map(latest, dependencies.items()))
    for name, current, version in releases:
        print(f"{name:20} {current:10} {version}")

if "--write" in sys.argv:
    text = (ROOT / "rust/Cargo.toml").read_text()
    for name, _current, version in releases:
        text, count = re.subn(
            rf'(?m)^({re.escape(name)}\s*=\s*(?:\{{\s*version\s*=\s*)?")[^"]+(".*)$',
            lambda match: f"{match.group(1)}{version}{match.group(2)}",
            text,
        )
        if count != 1:
            raise RuntimeError(f"expected one declaration for {name}, found {count}")
    (ROOT / "rust/Cargo.toml").write_text(text)
