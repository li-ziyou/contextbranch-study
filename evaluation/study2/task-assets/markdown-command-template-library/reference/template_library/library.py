"""Stable composition layer for the scoped Markdown command library."""

from collections.abc import Mapping
from pathlib import Path
import re

from .catalog import build_catalog, lookup_template


_PLACEHOLDER = re.compile(r"{{([A-Za-z_][A-Za-z0-9_]*)}}")


class TemplateLibrary:
    """Metadata-aware façade over a recursively indexed template directory."""

    def __init__(self, root: Path):
        self._catalog = build_catalog(Path(root))

    def list_templates(
        self, namespace: str | None = None, tag: str | None = None
    ) -> list[dict[str, object]]:
        """List template summaries, optionally filtered by namespace or tag."""
        items: list[dict[str, object]] = []
        for key, entry in self._catalog.items():
            metadata = entry.template.metadata
            if namespace is not None and metadata.namespace != namespace:
                continue
            if tag is not None and tag not in metadata.tags:
                continue
            items.append(
                {
                    "key": key,
                    "namespace": metadata.namespace,
                    "description": metadata.description,
                    "tags": metadata.tags,
                }
            )
        return sorted(items, key=lambda item: str(item["key"]))

    def get_template(self, key: str) -> str:
        """Return the complete source for one indexed template."""
        return lookup_template(self._catalog, key).template.source

    def get_template_body(self, key: str) -> str:
        """Return one indexed template without its metadata header."""
        return lookup_template(self._catalog, key).template.body

    def render(self, key: str, values: Mapping[str, object]) -> str:
        """Render ``{{name}}`` placeholders, rejecting missing values."""
        body = self.get_template_body(key)

        def substitute(match: re.Match[str]) -> str:
            name = match.group(1)
            if name not in values:
                raise KeyError(f"missing template value: {name}")
            return str(values[name])

        return _PLACEHOLDER.sub(substitute, body)


def open_library(root: Path) -> TemplateLibrary:
    """Create a library façade for ``root``."""
    return TemplateLibrary(root)
