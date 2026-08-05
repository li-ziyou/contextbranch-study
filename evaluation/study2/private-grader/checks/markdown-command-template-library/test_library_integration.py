from pathlib import Path

from template_library import get_template, get_template_body, list_templates


def test_filters_by_namespace_and_retrieves_complete_or_body_only_content(tmp_path: Path):
    (tmp_path / "alpha").mkdir()
    full = "---\nnamespace: alpha\ndescription: A\n---\n# A\n"
    (tmp_path / "alpha" / "a.md").write_text(full, encoding="utf-8")
    (tmp_path / "beta.md").write_text("---\nnamespace: beta\n---\n# B\n", encoding="utf-8")
    assert list_templates(tmp_path, namespace="alpha") == [{"key": "alpha/a", "description": "A"}]
    assert get_template(tmp_path, "alpha/a") == full
    assert get_template_body(tmp_path, "alpha/a") == "# A\n"
