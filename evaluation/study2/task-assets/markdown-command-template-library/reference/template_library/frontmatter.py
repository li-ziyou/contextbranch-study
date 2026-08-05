"""Read optional YAML frontmatter from a Markdown document."""

import yaml


def parse_frontmatter(content: str) -> tuple[dict[str, object], str]:
    """Return metadata and the Markdown body, failing closed on bad metadata."""
    if not content.startswith("---\n"):
        return {}, content
    closing = content.find("\n---\n", len("---\n"))
    if closing == -1:
        return {}, content
    metadata_text = content[len("---\n") : closing]
    try:
        metadata = yaml.safe_load(metadata_text)
    except yaml.YAMLError:
        return {}, content
    if not isinstance(metadata, dict):
        return {}, content
    return metadata, content[closing + len("\n---\n") :]
