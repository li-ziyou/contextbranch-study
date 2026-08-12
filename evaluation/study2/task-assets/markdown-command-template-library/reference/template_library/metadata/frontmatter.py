"""Parse the metadata contract at the start of a Markdown command template."""

from dataclasses import dataclass

import yaml


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


def _validate_metadata(value: object) -> TemplateMetadata:
    if value is None:
        value = {}
    if not isinstance(value, dict):
        raise ValueError("template metadata must be a YAML mapping")
    namespace = value.get("namespace", "")
    description = value.get("description", "")
    tags = value.get("tags", [])
    if not isinstance(namespace, str) or not isinstance(description, str):
        raise ValueError("namespace and description must be strings")
    if not isinstance(tags, list) or not all(isinstance(tag, str) and tag for tag in tags):
        raise ValueError("tags must be a list of non-empty strings")
    return TemplateMetadata(namespace=namespace, description=description, tags=tuple(tags))


def parse_template(source: str) -> ParsedTemplate:
    """Parse an optional YAML header and validate its supported fields."""
    if not source.startswith("---\n"):
        return ParsedTemplate(_validate_metadata({}), source, source)
    closing = source.find("\n---\n", len("---\n"))
    if closing == -1:
        raise ValueError("template header is missing its closing delimiter")
    metadata_source = source[len("---\n"):closing]
    try:
        loaded = yaml.safe_load(metadata_source)
    except yaml.YAMLError as error:
        raise ValueError("template metadata is not valid YAML") from error
    body = source[closing + len("\n---\n"):]
    return ParsedTemplate(_validate_metadata(loaded), body, source)
