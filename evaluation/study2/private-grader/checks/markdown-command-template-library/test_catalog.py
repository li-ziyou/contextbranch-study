from pathlib import Path

import pytest

from template_library.catalog import build_catalog, lookup_template


def test_missing_root_is_empty_and_nested_markdown_is_indexed(tmp_path: Path):
    assert build_catalog(tmp_path / "missing") == {}
    (tmp_path / "nested").mkdir()
    (tmp_path / "nested" / "keep.md").write_text("keep", encoding="utf-8")
    (tmp_path / "nested" / "skip.txt").write_text("skip", encoding="utf-8")
    assert list(build_catalog(tmp_path)) == ["nested/keep"]


@pytest.mark.parametrize("key", ["", "../outside", "nested/../keep", "nested\\keep"])
def test_lookup_rejects_unsafe_keys(tmp_path: Path, key: str):
    (tmp_path / "safe.md").write_text("safe", encoding="utf-8")
    with pytest.raises(KeyError):
        lookup_template(build_catalog(tmp_path), key)
