import re

import pytest

from exception_matcher import LeafMatcher


@pytest.mark.parametrize("kind", ["type", "tuple", "exact", "regex", "predicate"])
def test_success_has_no_failure_evidence(kind):
    # EG-A1/A2/A3: success must not carry a mismatch reason.
    matcher = {
        "type": lambda: LeafMatcher(ValueError),
        "tuple": lambda: LeafMatcher((TypeError, ValueError)),
        "exact": lambda: LeafMatcher(ValueError, "accepted"),
        "regex": lambda: LeafMatcher(ValueError, re.compile("cept")),
        "predicate": lambda: LeafMatcher(ValueError, predicate=lambda error: str(error) == "accepted"),
    }[kind]()
    result = matcher.match(ValueError("accepted"))
    assert result.matched
    assert result.evidence == (), "EG-A3: a successful leaf match has no failure evidence"
