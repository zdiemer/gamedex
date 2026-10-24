#!/usr/bin/env python3
"""Refresh the static preview catalogue and shell templates; production discovers live."""
import argparse
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
from component_catalog import catalogue_script, inventory


def check_component_boundaries():
    """Keep presentation in components/ while allowing feature orchestration."""
    for path in sorted((ROOT / "static").glob("*.js")):
        if path.stem.startswith("components-") or path.stem == "sw":
            continue
        source = path.read_text()
        matches = list(re.finditer(
            r"^(?:async\s+)?function\s+(\w+)\s*\(|^(?:const|let)\s+(\w+)\s*=.*=>",
            source, re.M))
        for i, match in enumerate(matches):
            name = match.group(1) or match.group(2)
            body = source[match.end():matches[i+1].start() if i+1 < len(matches) else len(source)]
            body = re.sub(r"/\*.*?\*/|^\s*//[^\n]*", "", body, flags=re.S | re.M)
            if re.search(r'class=["\x27]|createElement\(|innerHTML\s*=', body) or re.search(r"Html$", name):
                raise SystemExit(f"UI implementation outside components/: {path.name}:{name}")


def shell_templates(check=False):
    index = ROOT / "static/index.html"
    source = index.read_text()
    def include(match):
        path = ROOT / "static" / match.group(1)
        if not path.resolve().is_relative_to((ROOT / "static/components").resolve()):
            raise SystemExit("Shell component must live under static/components/")
        return "<!-- component: " + match.group(1) + " -->\n" + path.read_text().rstrip() + "\n<!-- /component -->"
    generated = re.sub(r"<!-- component: (components/[^ ]+) -->.*?<!-- /component -->",
                       include, source, flags=re.S)
    if check and generated != source:
        raise SystemExit("Shell templates are stale: run python3 tools/components/catalog.py")
    if not check:
        index.write_text(generated)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--stdout", action="store_true", help="Emit live catalogue for the local preview server")
    parser.add_argument("--static-dir", type=Path, default=ROOT / "static")
    args = parser.parse_args()
    if args.stdout:
        print(catalogue_script(args.static_dir), end="")
    else:
        check_component_boundaries()
        shell_templates(args.check)
        text = catalogue_script(args.static_dir)
        target = args.static_dir / "components-catalog.js"
        if args.check:
            if not target.exists() or target.read_text() != text:
                raise SystemExit("Static preview catalogue is stale: run python3 tools/components/catalog.py")
        else:
            target.write_text(text)
        print(f"{len(inventory(args.static_dir))} component source entries discovered")
