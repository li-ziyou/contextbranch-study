# Exception Group Matcher

## Task

Complete the leaf and nested-group matching behavior of the supplied
`exception_matcher` package.

## Files You Can Edit

- `exception_matcher/leaf.py`
- `exception_matcher/groups.py`

Do not modify `exception_matcher/contracts.py`, `exception_matcher/api.py`, or
`exception_matcher/__init__.py`.

## Provided API

The supplied `FailureCode`, `MatchEvidence`, `MatchResult`, `Matcher`, and
`matches` definitions are the shared contract.

| API | Result |
| --- | --- |
| `LeafMatcher(exception_type, message=None, predicate=None)` | Create a matcher for one leaf exception |
| `GroupMatcher(expected, flatten=False, allow_unwrapped=False)` | Create a matcher for an exception group |
| `matcher.match(actual)` | Return a `MatchResult` |
| `matches(expected, actual)` | Run any supplied `Matcher` |
| `MatchResult.matched` | Whether the complete match succeeded |
| `MatchResult.evidence` | A tuple of structured mismatch evidence |

## Example

```python
from exception_matcher import GroupMatcher, LeafMatcher, matches

expected = GroupMatcher([LeafMatcher(ValueError, "bad value")])
actual = ExceptionGroup("errors", [ValueError("bad value")])

result = matches(expected, actual)

assert result.matched is True
assert result.evidence == ()
```

## Requirements

### Responsibility A: leaf matching

- EG-A1: `LeafMatcher` matches a leaf exception by `isinstance` against one type or a tuple of types and rejects exception groups as leaves.
- EG-A2: an optional string requires an exact exception message, an optional compiled regular expression uses `search`, and an optional predicate must return true.
- EG-A3: every leaf mismatch returns an unmatched `MatchResult` with the corresponding `FailureCode`; successful matches contain no failure evidence.

### Responsibility B: nested group matching

- EG-B1: `GroupMatcher` preserves nested group boundaries by default, so a nested group is matched by a nested matcher rather than by a leaf matcher.
- EG-B2: `flatten=True` recursively exposes leaves for matching while retaining each leaf's original index path in failure evidence.
- EG-B3: `allow_unwrapped=True` delegates a non-group exception only when there is exactly one expected matcher; otherwise a group is required.
- EG-B4: expected matchers pair in expected order with the first still-unmatched successful actual item; failures report unmatched expected and unexpected actual items and flag when another complete pairing exists.

### Integration

- EG-I1: group matching consumes the shared `Matcher`/`MatchResult` contract and preserves leaf failure codes together with expected indexes, actual indexes, and nested actual paths.

## Run Tests

Run either the focused tests or the complete public suite:

```bash
pytest -q tests/test_responsibility_a.py
pytest -q tests/test_responsibility_b.py
pytest -q tests/test_integration.py
pytest -q tests
```

The controlled study runner executes the same public suite:

```bash
python3 .study/bin/study_runner.py public --workspace .
```

## Submission

Submit only the final `main` state. Only code present in `main` is graded.
