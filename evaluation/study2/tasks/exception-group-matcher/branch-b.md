# Responsibility B: nested group matching

- EG-B1: `GroupMatcher` preserves nested group boundaries by default, so a nested group is matched by a nested matcher rather than by a leaf matcher.
- EG-B2: `flatten=True` recursively exposes leaves for matching while retaining each leaf's original index path in failure evidence.
- EG-B3: `allow_unwrapped=True` delegates a non-group exception only when there is exactly one expected matcher; otherwise a group is required.
- EG-B4: expected matchers pair in expected order with the first still-unmatched successful actual item; failures report unmatched expected and unexpected actual items and flag when another complete pairing exists.

For EG-B3, an ordinary exception is accepted as input only when the option is
enabled and there is exactly one expected matcher. Delegate to that matcher and
return its result, including failure details. A disabled option, zero expected
matchers, or multiple expected matchers requires `EXPECTED_GROUP`.

For EG-B4, distinguish the greedy result from the existence of a complete
alternative assignment. With expected `[any ValueError, ValueError("x")]` and
actual `[ValueError("x"), ValueError("y")]`, greedy pairing fails but a complete
alternative exists: assign `y` to the first matcher and `x` to the second.
Return `matched=False` and `possible_alternative_pairing=True`. With expected
`[ValueError, TypeError]` and actual `[ValueError(), ValueError()]`, no complete
assignment exists, so both fields are false. A successful pairing need not
evaluate all remaining matcher/exception combinations.
