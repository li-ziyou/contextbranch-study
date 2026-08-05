from mlflow.ai_commands import ai_command_utils as commands


class _ModulePath:
    def __init__(self, parent):
        self.parent = parent


def test_lists_nested_templates_in_key_order_and_filters_namespace(monkeypatch, tmp_path):
    (tmp_path / "alpha").mkdir()
    (tmp_path / "alpha" / "z.md").write_text("---\nnamespace: alpha\n---\nZ")
    (tmp_path / "alpha" / "a.md").write_text("---\ndescription: A\n---\nA")
    (tmp_path / "beta" / "inner").mkdir(parents=True)
    (tmp_path / "beta" / "inner" / "b.md").write_text("---\nnamespace: beta\n---\nB")
    monkeypatch.setattr(commands, "Path", lambda _file: _ModulePath(tmp_path))

    all_items = commands.list_commands()
    assert [item["key"] for item in all_items] == ["alpha/a", "alpha/z", "beta/inner/b"]
    assert [item["key"] for item in commands.list_commands("alpha")] == ["alpha/a", "alpha/z"]
    assert all_items[0]["description"] == "A"


def test_missing_template_directory_is_an_empty_library(monkeypatch, tmp_path):
    monkeypatch.setattr(commands, "Path", lambda _file: _ModulePath(tmp_path / "missing"))
    assert commands.list_commands() == []
