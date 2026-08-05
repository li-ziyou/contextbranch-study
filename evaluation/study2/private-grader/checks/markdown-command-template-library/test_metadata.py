from mlflow.ai_commands import parse_frontmatter


def test_parses_mapping_metadata_and_leaves_markdown_body():
    metadata, body = parse_frontmatter("---\nnamespace: ops\ndescription: Run checks\n---\n# Checks\n")
    assert metadata["namespace"] == "ops"
    assert body == "# Checks\n"


def test_malformed_frontmatter_fails_closed():
    malformed = "---\nkey: value: [\n---\ncontent"
    assert parse_frontmatter(malformed) == ({}, malformed)
