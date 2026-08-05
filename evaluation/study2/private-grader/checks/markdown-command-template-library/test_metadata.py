from template_library.frontmatter import parse_frontmatter


def test_malformed_or_non_mapping_frontmatter_fails_closed():
    malformed = "---\nkey: value: [\n---\ncontent"
    assert parse_frontmatter(malformed) == ({}, malformed)
    list_metadata = "---\n- first\n- second\n---\ncontent"
    assert parse_frontmatter(list_metadata) == ({}, list_metadata)


def test_document_without_frontmatter_is_unchanged():
    content = "# Plain Markdown\n"
    assert parse_frontmatter(content) == ({}, content)
