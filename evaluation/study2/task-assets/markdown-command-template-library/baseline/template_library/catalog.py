"""Find and read Markdown templates stored under one library root."""

from pathlib import Path


def list_markdown_files(root: Path) -> list[Path]:
    """Return every Markdown file below ``root`` in key order."""
    raise NotImplementedError("Implement recursive template discovery.")


def read_template(root: Path, key: str) -> str:
    """Read the Markdown file addressed by a slash-separated template key."""
    raise NotImplementedError("Implement template retrieval.")
