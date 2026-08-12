from pathlib import Path

from template_library import open_library
from template_library.catalog import build_catalog
from template_library.metadata import ParsedTemplate, TemplateMetadata, parse_template


def test_parses_validated_metadata_and_keeps_the_template_body():
    parsed = parse_template(
        "---\nnamespace: data\ndescription: Inspect a run\ntags: [run, inspect]\n---\n"
        "# Inspect {{run_id}}\n"
    )
    assert parsed.metadata.namespace == "data"
    assert parsed.metadata.tags == ("run", "inspect")
    assert parsed.body == "# Inspect {{run_id}}\n"


def test_builds_a_recursive_catalog_with_canonical_keys(tmp_path: Path, monkeypatch):
    (tmp_path / "data" / "runs").mkdir(parents=True)
    (tmp_path / "data" / "runs" / "inspect.md").write_text("# Inspect\n", encoding="utf-8")
    (tmp_path / "notes.txt").write_text("ignore", encoding="utf-8")

    # This focused check holds the metadata contract constant. It lets the
    # catalog responsibility be verified independently before integration.
    monkeypatch.setattr(
        "template_library.catalog.index.parse_template",
        lambda source: ParsedTemplate(
            metadata=TemplateMetadata(namespace="", description="", tags=()),
            body=source,
            source=source,
        ),
    )
    assert list(build_catalog(tmp_path)) == ["data/runs/inspect"]


def test_lists_filters_and_renders_after_both_areas_are_implemented(tmp_path: Path):
    path = tmp_path / "data" / "inspect.md"
    path.parent.mkdir()
    path.write_text(
        "---\nnamespace: data\ndescription: Inspect a run\ntags: [run]\n---\n"
        "# Inspect {{run_id}}\n",
        encoding="utf-8",
    )
    library = open_library(tmp_path)
    assert library.list_templates(namespace="data", tag="run") == [
        {
            "key": "data/inspect",
            "namespace": "data",
            "description": "Inspect a run",
            "tags": ("run",),
        }
    ]
    assert library.render("data/inspect", {"run_id": "42"}) == "# Inspect 42\n"
