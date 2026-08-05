from pathlib import Path

from template_library import get_template_body, list_templates
from template_library.catalog import list_markdown_files
from template_library.frontmatter import parse_frontmatter


def test_reads_optional_metadata_and_returns_body():
    content = "---\nnamespace: data\ndescription: Inspect a run\n---\n# Inspect\nBody\n"
    metadata, body = parse_frontmatter(content)
    assert metadata == {"namespace": "data", "description": "Inspect a run"}
    assert body == "# Inspect\nBody\n"


def test_discovers_nested_templates_in_key_order(tmp_path: Path):
    (tmp_path / "data" / "runs").mkdir(parents=True)
    (tmp_path / "data" / "runs" / "inspect.md").write_text("# Inspect\n", encoding="utf-8")
    (tmp_path / "about.md").write_text("# About\n", encoding="utf-8")
    assert [path.relative_to(tmp_path).as_posix() for path in list_markdown_files(tmp_path)] == [
        "about.md",
        "data/runs/inspect.md",
    ]


def test_lists_and_retrieves_templates_after_both_areas_are_implemented(tmp_path: Path):
    path = tmp_path / "data" / "inspect.md"
    path.parent.mkdir()
    path.write_text("---\nnamespace: data\ndescription: Inspect a run\n---\n# Inspect\n", encoding="utf-8")
    assert list_templates(tmp_path) == [{"key": "data/inspect", "description": "Inspect a run"}]
    assert get_template_body(tmp_path, "data/inspect") == "# Inspect\n"
