# Exception Group local behavioral contract

## Pinned source

- FeatureBench instance: `pytest-dev__pytest.68016f0e.raises_group.c28bf36a.lv1`
- Upstream repository: `pytest-dev/pytest`
- Revision: `68016f0effe59cd91120112f5170fdd057dba1d9`
- Upstream F2P evidence: `testing/python/raises_group.py`
- Upstream P2P boundary: `testing/test_stepwise.py`, `testing/code/test_excinfo.py`, `testing/test_helpconfig.py`, `testing/python/collect.py`, `testing/test_link_resolve.py`

F2P and P2P identify the source behavior and regression boundary. They are not local participant or grader tests. The local package, ticket, examples, and tests are newly authored.

## Public interface

`Matcher.match(BaseException) -> MatchResult` is the shared contract. `LeafMatcher` implements leaf type/message/predicate matching. `GroupMatcher` composes arbitrary `Matcher` objects for nested or flattened exception groups. `MatchEvidence` carries a `FailureCode` and optional expected index, actual index, and nested actual path. Participants may edit only `leaf.py` and `groups.py`.

## Requirements

| ID | Participant-visible rule | Interface | Observable result | Layer | Upstream evidence |
|---|---|---|---|---|---|
| EG-A1 | Leaf type matching uses `isinstance` and rejects groups. | `LeafMatcher.match` | Subtypes/tuples match; wrong type or group gives the disclosed failure code. | A | Flexible exception matching in source task and F2P file. |
| EG-A2 | String, regex search, and predicate checks are optional filters. | `LeafMatcher` constructor and `match` | All supplied filters must accept the leaf. | A | Regex and custom validation in source task and F2P file. |
| EG-A3 | Leaf outcomes use structured `MatchResult` evidence. | `MatchResult`, `MatchEvidence`, `FailureCode` | Success has no evidence; failure has the corresponding public code. | A | Detailed diagnostics in source task and F2P file. |
| EG-B1 | Nested boundaries are preserved by default. | `GroupMatcher` | Nested actual groups require nested expected matchers. | B | Nested exception structures in source task and F2P file. |
| EG-B2 | Flatten recursively exposes leaves and retains original paths. | `GroupMatcher(flatten=True)` | Leaves pair at one level; failure locations keep nested indexes. | B | Flatten subgroup behavior in source task and F2P file. |
| EG-B3 | Unwrapped delegation is limited to one expected matcher. | `GroupMatcher(allow_unwrapped=True)` | One matcher receives the leaf; other cases return `EXPECTED_GROUP`. | B | Unwrapped exception behavior in source task and F2P file. |
| EG-B4 | Pairing is expected-order greedy and reports recoverable alternatives. | `GroupMatcher.match` | First unused success pairs; failures identify leftovers and possible full rematching. | B | Greedy matching and alternative suggestions in source task and F2P file. |
| EG-I1 | Groups consume and preserve the shared matcher result contract. | `Matcher`, `MatchResult`, `matches` | Custom/leaf evidence survives composition with indexes and nested paths. | Integration | Interaction of source task matching and diagnostic themes. |

No local check requires context-manager behavior, repr formatting, exact diagnostic text, generic typing internals, or helper names absent from the main ticket.
