"""Find and read Markdown templates stored under one library root."""

from pathlib import Path


def list_markdown_files(root: Path) -> list[Path]:
    """Return every Markdown file below ``root`` in key order."""
    root = Path(root)
    if not root.is_dir():
        return []
    return sorted(path for path in root.rglob("*.md") if path.is_file())


def read_template(root: Path, key: str) -> str:
    """Read the Markdown file addressed by a slash-separated template key."""
    root = Path(root).resolve()
    candidate = (root / f"{key}.md").resolve()
    if root not in candidate.parents or not candidate.is_file():
        raise FileNotFoundError(f"Template '{key}' not found")
    return candidate.read_text(encoding="utf-8")
