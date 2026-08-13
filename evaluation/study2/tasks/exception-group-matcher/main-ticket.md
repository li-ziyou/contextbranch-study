# Exception Group Matcher

Implement the missing leaf and group matching behavior for the supplied `exception_matcher` package.

## Public interface

The supplied `FailureCode`, `MatchEvidence`, `MatchResult`, `Matcher`, and `matches` definitions are the shared contract. Do not change `exception_matcher/contracts.py`, `exception_matcher/api.py`, or `exception_matcher/__init__.py`.

You may edit only:

- `exception_matcher/leaf.py`
- `exception_matcher/groups.py`

Example use of the supplied interface:

```python
expected = GroupMatcher([LeafMatcher(ValueError, "bad value")])
result = matches(expected, ExceptionGroup("errors", [ValueError("bad value")]))
```

## Acceptance requirements

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

## Public tests

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

Submit only the final main state. Optional sibling states may be used in any order, or not used. Only changes integrated into main are graded.
