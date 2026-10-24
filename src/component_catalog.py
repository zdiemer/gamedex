"""Discover library source entries from the component tree without a registry.

Reading source never imports or executes component code. Every supported file is
represented, including templates and modules with no recognized declarations.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re

FOLDERS = {
    "foundations": ("Foundations", "home"),
    "controls": ("Controls & dialogs", "home"),
    "navigation": ("Navigation & account", "home"),
    "lists": ("Game tiles & lists", "games"),
    "drawer": ("Detail drawer", "games"),
    "panels": ("Detail drawer", "games"),
    "account": ("Account & personal data", "games"),
    "admin": ("Admin & editing", "health"),
    "discovery": ("Home & discovery", "home"),
    "collections": ("Collections & challenges", "groups"),
    "statistics": ("Charts & statistics", "stats"),
    "recommendations": ("Recommendations & wishlist", "recs"),
    "games": ("Daily games", "daily"),
    "events": ("Events & themes", "events"),
    "media": ("Media & audio", "games"),
    "shelf": ("Shelf & physical media", "shelf"),
    "feedback": ("Loading & feedback", "home"),
}
EXTENSIONS = {".js", ".mjs", ".html", ".svg", ".css", ".json"}
# Declarations start in column zero, following this repo's plain-script convention.
# Unusual/export-default syntax still appears via the file-level fallback.
DECLARATION = re.compile(
    r"^(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function\s*\*?\s*|class\s+)([\w$]+)"
    r"|^(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=",
    re.M,
)


def entry_id(file: str, name: str = "") -> str:
    raw = file + (":" + name if name else "")
    readable = re.sub(r"[^\w-]+", "-", raw, flags=re.ASCII).strip("-")
    # Fit the SPA's component query validator and distinguish sanitization collisions.
    return readable[:100] + "-" + hashlib.sha256(raw.encode()).hexdigest()[:10]


def inventory(static_dir: Path) -> list[dict]:
    static_dir = Path(static_dir).resolve()
    root = static_dir / "components"
    records = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in EXTENSIONS:
            continue
        # Do not turn a component symlink into a source disclosure outside static/.
        if not path.resolve().is_relative_to(root.resolve()):
            continue
        file = path.relative_to(static_dir).as_posix()
        folder = path.relative_to(root).parts[0] if path.parent != root else "components"
        category, tab = FOLDERS.get(folder, (folder.replace("-", " ").title(), "home"))
        source = path.read_text(encoding="utf-8")
        matches = list(DECLARATION.finditer(source)) if path.suffix in {".js", ".mjs"} else []
        for match in matches:
            name = match.group(1) or match.group(2)
            records.append(dict(
                id=entry_id(file, name), legacyId=f"{path.stem}-{name}",
                name=name, symbol=name, file=file,
                line=source[:match.start()].count("\n") + 1,
                category=category, tab=tab,
            ))
        if not matches:
            records.append(dict(
                id=entry_id(file), name=path.stem.replace("-", " ").title(),
                file=file, line=1, category=category, tab=tab,
                description="Component source discovered automatically from its folder.",
            ))
    return records


def catalogue_script(static_dir: Path) -> str:
    return ("// Automatically discovered from static/components/; do not edit.\n"
            "const COMPONENT_SOURCES = " + json.dumps(inventory(static_dir), indent=2) + ";\n")
