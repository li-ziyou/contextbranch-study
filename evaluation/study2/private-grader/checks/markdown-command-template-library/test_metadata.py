import pytest

from template_library.metadata import parse_template


def test_no_header_has_empty_metadata_and_an_unchanged_body():
    parsed = parse_template("# Plain command\n")
    assert parsed.metadata.namespace == ""
    assert parsed.metadata.description == ""
    assert parsed.metadata.tags == ()
    assert parsed.body == "# Plain command\n"


@pytest.mark.parametrize(
    "source",
    [
        "---\nnamespace: [not-a-string]\n---\nbody",
        "---\ntags: [valid, 7]\n---\nbody",
        "---\nkey: value: [\n---\nbody",
        "---\nnamespace: data\nbody",
    ],
)
def test_invalid_headers_are_rejected(source: str):
    with pytest.raises(ValueError):
        parse_template(source)
