from pathlib import Path

from mlflow.ai_commands import ai_command_utils as commands


class _ModulePath:
    def __init__(self, parent):
        self.parent = parent


def _use_template_root(monkeypatch, root: Path):
    monkeypatch.setattr(commands, "Path", lambda _file: _ModulePath(root))


def test_reads_optional_metadata_and_returns_body():
    content = "---\nnamespace: data\ndescription: Inspect a run\n---\n# Inspect\nBody\n"
    metadata, body = commands.parse_frontmatter(content)
    assert metadata == {"namespace": "data", "description": "Inspect a run"}
    assert body == "# Inspect\nBody\n"


def test_discovers_nested_templates_and_retrieves_content(monkeypatch, tmp_path):
    template = tmp_path / "data" / "runs" / "inspect.md"
    template.parent.mkdir(parents=True)
    template.write_text("---\nnamespace: data\ndescription: Inspect\n---\n# Inspect\n")
    _use_template_root(monkeypatch, tmp_path)

    listed = commands.list_commands()
    assert [item["key"] for item in listed] == ["data/runs/inspect"]
    assert commands.get_command("data/runs/inspect").startswith("---")
