import pytest

from mlflow.ai_commands import ai_command_utils as commands


class _ModulePath:
    def __init__(self, parent):
        self.parent = parent


def test_retrieves_full_template_and_body_without_frontmatter(monkeypatch, tmp_path):
    path = tmp_path / "reports" / "summary.md"
    path.parent.mkdir()
    full = "---\nnamespace: reports\n---\n# Summary\n"
    path.write_text(full)
    monkeypatch.setattr(commands, "Path", lambda _file: _ModulePath(tmp_path))
    assert commands.get_command("reports/summary") == full
    assert commands.get_command_body("reports/summary") == "# Summary\n"


def test_retrieval_uses_slash_separated_key_and_reports_missing_file(monkeypatch, tmp_path):
    monkeypatch.setattr(commands, "Path", lambda _file: _ModulePath(tmp_path))
    with pytest.raises(FileNotFoundError, match="Command 'missing/template' not found"):
        commands.get_command("missing/template")
