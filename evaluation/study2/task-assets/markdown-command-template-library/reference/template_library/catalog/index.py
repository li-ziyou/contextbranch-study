"""Build and query a safe recursive catalog of Markdown templates."""

from dataclasses import dataclass
from pathlib import Path

from template_library.metadata import ParsedTemplate, parse_template


@dataclass(frozen=True)
class TemplateEntry:
    """One indexed template, identified by a canonical slash-separated key."""

    key: str
    path: Path
    template: ParsedTemplate


def build_catalog(root: Path) -> dict[str, TemplateEntry]:
    """Recursively parse ``*.md`` files below ``root`` into a canonical index."""
    root = Path(root)
    if not root.is_dir():
        return {}
    catalog: dict[str, TemplateEntry] = {}
    for path in sorted(candidate for candidate in root.rglob("*.md") if candidate.is_file()):
        key = path.relative_to(root).with_suffix("").as_posix()
        if key in catalog:
            raise ValueError(f"duplicate template key: {key}")
        source = path.read_text(encoding="utf-8")
        catalog[key] = TemplateEntry(key=key, path=path, template=parse_template(source))
    return catalog


def lookup_template(catalog: dict[str, TemplateEntry], key: str) -> TemplateEntry:
    """Return an indexed template for a safe, canonical key."""
    if not key or "\\" in key or ".." in key.split("/"):
        raise KeyError(f"invalid template key: {key!r}")
    try:
        return catalog[key]
    except KeyError as error:
        raise KeyError(f"template not found: {key}") from error
