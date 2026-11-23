import pytest

from exception_matcher import FailureCode, GroupMatcher, MatchEvidence, MatchResult


class FeedbackMatcher:
    def __init__(self, exception_type, message=None):
        self.exception_type, self.message = exception_type, message

    def match(self, actual):
        if not isinstance(actual, self.exception_type):
            return MatchResult.failure(MatchEvidence(FailureCode.TYPE_MISMATCH, "wrong type"))
        if self.message is not None and str(actual) != self.message:
            return MatchResult.failure(MatchEvidence(FailureCode.MESSAGE_MISMATCH, "wrong message"))
        return MatchResult.success()


@pytest.mark.parametrize("enabled,count", [(False, 0), (False, 1), (False, 2), (True, 0), (True, 2)])
def test_unwrapped_input_requires_enabled_flag_and_one_matcher(enabled, count):
    # EG-B3: each gate is reported as a separate failing case.
    result = GroupMatcher([FeedbackMatcher(ValueError)] * count, allow_unwrapped=enabled).match(ValueError())
    assert not result.matched
    assert result.evidence, "EG-B3: rejected unwrapped input needs failure evidence"
    assert result.evidence[0].code is FailureCode.EXPECTED_GROUP


def test_unwrapped_input_with_one_matcher_delegates_its_result():
    # EG-B3: shared Matcher may return its own failure details.
    expected = MatchResult.failure(MatchEvidence(FailureCode.PREDICATE_REJECTED, "custom rejection"))

    class CustomMatcher:
        def match(self, actual):
            assert actual is error
            return expected

    error = ValueError("example")
    assert GroupMatcher([CustomMatcher()], allow_unwrapped=True).match(error) == expected


def test_greedy_failure_can_have_a_complete_alternative(form_value):
    # EG-B4: greedy consumes the specific exception too early.
    specific, other = form_value("x", "chosen"), form_value("y", "other")
    actual = ExceptionGroup("values", [ValueError(specific), ValueError(other)])
    result = GroupMatcher([FeedbackMatcher(ValueError), FeedbackMatcher(ValueError, specific)]).match(actual)
    assert not result.matched, "EG-B4: the reported match still follows greedy order"
    assert result.possible_alternative_pairing


def test_greedy_failure_without_a_complete_alternative():
    # EG-B4: two ValueErrors cannot satisfy an expected TypeError.
    actual = ExceptionGroup("values", [ValueError("x"), ValueError("y")])
    result = GroupMatcher([FeedbackMatcher(ValueError), FeedbackMatcher(TypeError)]).match(actual)
    assert not result.matched
    assert not result.possible_alternative_pairing, "EG-B4: no type-compatible complete assignment exists"
