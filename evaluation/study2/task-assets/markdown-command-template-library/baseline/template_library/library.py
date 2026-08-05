"""Stable composition layer for the Markdown template library.

This file is supplied as working orchestration. The feature work is confined
to ``frontmatter.py`` and ``catalog.py`` so two independent implementations
can later be integrated without a shared-file edit.
"""

from pathlib import Path

from .catalog import list_markdown_files, read_template
from .frontmatter import parse_frontmatter


def _template_key(root: Path, path: Path) -> str:
    return path.relative_to(root).with_suffix("").as_posix()


def list_templates(root: Path, namespace: str | None = None) -> list[dict[str, str]]:
    """List templates, optionally keeping only one metadata namespace."""
    root = Path(root)
    items: list[dict[str, str]] = []
    for path in list_markdown_files(root):
        metadata, _ = parse_frontmatter(path.read_text(encoding="utf-8"))
        if namespace is not None and metadata.get("namespace") != namespace:
            continue
        items.append(
            {
                "key": _template_key(root, path),
                "description": str(metadata.get("description", "")),
            }
        )
    return sorted(items, key=lambda item: item["key"])


def get_template(root: Path, key: str) -> str:
    """Return the complete Markdown template for ``key``."""
    return read_template(Path(root), key)


def get_template_body(root: Path, key: str) -> str:
    """Return a template after optional metadata has been removed."""
    _, body = parse_frontmatter(get_template(root, key))
    return body
