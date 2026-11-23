from dataclasses import dataclass

from exception_matcher import FailureCode, GroupMatcher, MatchEvidence, MatchResult


@dataclass(frozen=True)
class StubMatcher:
    exception_type: type[BaseException]
    message: str | None = None

    def match(self, actual: BaseException) -> MatchResult:
        if isinstance(actual, BaseExceptionGroup):
            return MatchResult.failure(MatchEvidence(FailureCode.UNEXPECTED_GROUP, "group"))
        if not isinstance(actual, self.exception_type):
            return MatchResult.failure(MatchEvidence(FailureCode.TYPE_MISMATCH, "type"))
        if self.message is not None and str(actual) != self.message:
            return MatchResult.failure(MatchEvidence(FailureCode.MESSAGE_MISMATCH, "message"))
        return MatchResult.success()


def test_nested_group_boundaries_are_matched_explicitly():
    # EG-B1
    matcher = GroupMatcher([GroupMatcher([StubMatcher(ValueError)])])
    actual = ExceptionGroup("outer", [ExceptionGroup("inner", [ValueError()])])
    assert matcher.match(actual).matched


def test_flatten_and_unwrapped_modes_are_explicit():
    # EG-B2, EG-B3
    nested = ExceptionGroup("outer", [ExceptionGroup("inner", [TypeError("x")])])
    assert GroupMatcher([StubMatcher(TypeError)], flatten=True).match(nested).matched
    assert GroupMatcher([StubMatcher(TypeError)], allow_unwrapped=True).match(TypeError("x")).matched
    result = GroupMatcher([StubMatcher(TypeError), StubMatcher(ValueError)], allow_unwrapped=True).match(TypeError("x"))
    assert result.evidence[0].code is FailureCode.EXPECTED_GROUP


def test_greedy_failure_reports_a_possible_complete_pairing(form_value):
    # EG-B4
    specific = form_value("x", "chosen")
    other = form_value("y", "other")
    matcher = GroupMatcher([StubMatcher(ValueError), StubMatcher(ValueError, specific)])
    actual = ExceptionGroup("values", [ValueError(specific), ValueError(other)])
    result = matcher.match(actual)
    assert not result.matched
    assert result.possible_alternative_pairing


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
