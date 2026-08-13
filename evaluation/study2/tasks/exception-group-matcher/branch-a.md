# Responsibility A: leaf matching

- EG-A1: `LeafMatcher` matches a leaf exception by `isinstance` against one type or a tuple of types and rejects exception groups as leaves.
- EG-A2: an optional string requires an exact exception message, an optional compiled regular expression uses `search`, and an optional predicate must return true.
- EG-A3: every leaf mismatch returns an unmatched `MatchResult` with the corresponding `FailureCode`; successful matches contain no failure evidence.
