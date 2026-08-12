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
    """Recursively parse ``*.md`` files below ``root`` into a canonical index.

    Missing roots produce an empty index. Non-Markdown files are ignored. Keys
    are relative POSIX paths without the ``.md`` suffix and must be unique.
    """
    raise NotImplementedError("Implement recursive template indexing.")


def lookup_template(catalog: dict[str, TemplateEntry], key: str) -> TemplateEntry:
    """Return an indexed template for a safe, canonical key.

    Empty keys, parent-directory traversal, backslashes, and unknown keys must
    raise ``KeyError`` rather than selecting another template.
    """
    raise NotImplementedError("Implement safe template lookup.")
