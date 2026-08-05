"""Read optional YAML frontmatter from a Markdown document."""


def parse_frontmatter(content: str) -> tuple[dict[str, object], str]:
    """Return metadata and the Markdown body.

    A document without opening and closing ``---`` lines has no metadata. If
    the metadata is malformed or is not a mapping, return an empty mapping and
    leave the original content unchanged.
    """
    raise NotImplementedError("Implement Markdown frontmatter parsing.")
