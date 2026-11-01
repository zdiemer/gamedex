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


# Contracts are opt-in JSDoc immediately before a declaration. Values stay plain
# text, including examples: discovery never imports code or renders documentation
# as HTML. Unannotated declarations continue to appear in the source inventory.
DOC_COMMENT = re.compile(r"/\*\*(.*?)\*/", re.S)
CONTRACT_TAGS = {
    "param": "params", "returns": "returns", "requires": "requires",
    "events": "events", "cleanup": "cleanup", "escaping": "escaping",
    "example": "examples",
}
REPEATED_TAGS = {"param", "requires", "events", "example"}


def parse_contract(body: str) -> dict | None:
    lines = [re.sub(r"^\s*\* ?", "", line).rstrip() for line in body.splitlines()]
    if not any(re.match(r"^\s*@component(?:\s|$)", line) for line in lines):
        return None
    sections: dict[str, list[str]] = {}
    tag, text = "summary", []
    for line in lines:
        match = re.match(r"^\s*@([a-zA-Z]+)(?:\s+(.*))?$", line)
        if match:
            sections.setdefault(tag, []).append("\n".join(text).strip())
            tag, first = match.groups()
            tag = "summary" if tag == "component" else tag
            text = [first or ""]
        else:
            text.append(line)
    sections.setdefault(tag, []).append("\n".join(text).strip())
    summary = "\n".join(value for value in sections.pop("summary", []) if value)
    result = {"summary": summary}
    warnings = []
    for tag, values in sections.items():
        if tag not in CONTRACT_TAGS:
            warnings.append(f"Unknown contract tag: @{tag}")
            continue
        values = [value for value in values if value]
        if tag in REPEATED_TAGS:
            result[CONTRACT_TAGS[tag]] = values
        else:
            if len(values) > 1:
                warnings.append(f"Use @{tag} only once")
            result[CONTRACT_TAGS[tag]] = "\n".join(values)
    for field in ["summary", "params", "returns", "requires", "events", "cleanup", "escaping", "examples"]:
        if not result.get(field):
            warnings.append(f"Missing contract field: {field}")
    if warnings:
        result["warnings"] = warnings
    return result


def declaration_contracts(source: str) -> dict[int, dict]:
    contracts = {}
    for comment in DOC_COMMENT.finditer(source):
        start = comment.end()
        while start < len(source) and source[start].isspace():
            start += 1
        if DECLARATION.match(source, start):
            contract = parse_contract(comment.group(1))
            if contract is not None:
                contracts[start] = contract
    return contracts


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
        # Examples inside JSDoc are documentation, not additional declarations.
        doc_spans = [(comment.start(), comment.end()) for comment in DOC_COMMENT.finditer(source)]
        matches = [match for match in matches if not any(start <= match.start() < end for start, end in doc_spans)]
        contracts = declaration_contracts(source) if matches else {}
        for match in matches:
            name = match.group(1) or match.group(2)
            records.append(dict(
                id=entry_id(file, name), legacyId=f"{path.stem}-{name}",
                name=name, symbol=name, file=file,
                line=source[:match.start()].count("\n") + 1,
                category=category, tab=tab,
                **({"contract": contracts[match.start()]} if match.start() in contracts else {}),
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
