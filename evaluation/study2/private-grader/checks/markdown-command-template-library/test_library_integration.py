from pathlib import Path

import pytest

from template_library import open_library


def test_library_combines_metadata_filters_catalog_lookup_and_rendering(tmp_path: Path):
    (tmp_path / "alpha").mkdir()
    (tmp_path / "alpha" / "a.md").write_text(
        "---\nnamespace: alpha\ndescription: A\ntags: [daily]\n---\nHello {{name}}\n",
        encoding="utf-8",
    )
    (tmp_path / "beta.md").write_text(
        "---\nnamespace: beta\ndescription: B\ntags: [weekly]\n---\n# B\n",
        encoding="utf-8",
    )
    library = open_library(tmp_path)
    assert [item["key"] for item in library.list_templates(tag="daily")] == ["alpha/a"]
    assert library.get_template_body("alpha/a") == "Hello {{name}}\n"
    assert library.render("alpha/a", {"name": "Ada"}) == "Hello Ada\n"
    with pytest.raises(KeyError, match="missing template value"):
        library.render("alpha/a", {})
