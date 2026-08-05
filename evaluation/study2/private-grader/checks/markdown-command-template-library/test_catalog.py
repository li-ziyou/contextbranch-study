from pathlib import Path

import pytest

from template_library.catalog import list_markdown_files, read_template


def test_missing_root_is_an_empty_catalog_and_non_markdown_files_are_ignored(tmp_path: Path):
    assert list_markdown_files(tmp_path / "missing") == []
    (tmp_path / "notes.txt").write_text("ignore", encoding="utf-8")
    (tmp_path / "nested").mkdir()
    (tmp_path / "nested" / "keep.md").write_text("keep", encoding="utf-8")
    assert [path.relative_to(tmp_path).as_posix() for path in list_markdown_files(tmp_path)] == ["nested/keep.md"]


def test_retrieval_rejects_missing_or_escaping_keys(tmp_path: Path):
    (tmp_path / "safe.md").write_text("safe", encoding="utf-8")
    assert read_template(tmp_path, "safe") == "safe"
    with pytest.raises(FileNotFoundError):
        read_template(tmp_path, "missing")
    with pytest.raises(FileNotFoundError):
        read_template(tmp_path, "../outside")
