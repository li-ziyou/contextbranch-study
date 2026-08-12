"""Parse the metadata contract at the start of a Markdown command template."""

from dataclasses import dataclass


@dataclass(frozen=True)
class TemplateMetadata:
    """Normalized metadata that can be used to describe and filter a template."""

    namespace: str
    description: str
    tags: tuple[str, ...]


@dataclass(frozen=True)
class ParsedTemplate:
    """A template's normalized metadata, body, and original source text."""

    metadata: TemplateMetadata
    body: str
    source: str


def parse_template(source: str) -> ParsedTemplate:
    """Parse an optional YAML header and validate its supported fields.

    A template without a header has empty metadata and keeps its full source as
    the body. A header is delimited by opening and closing lines containing
    only ``---``. Header values must form a mapping: ``namespace`` and
    ``description`` are strings when present, and ``tags`` is a list of
    strings. Invalid YAML or invalid field types raise ``ValueError``.
    """
    raise NotImplementedError("Implement Markdown metadata parsing and validation.")
