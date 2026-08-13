# Exception Group test model

## Category-Partition model

| Category | Choices | Constraint |
|---|---|---|
| Actual shape | leaf, flat group, nested group, deep nested group | Leaf with group matcher requires allow-unwrapped and exactly one expectation. |
| Leaf type | exact, subtype, member of tuple, wrong type, group | Group is always rejected by `LeafMatcher`. |
| Message filter | none, exact string pass/fail, regex search pass/fail | String and compiled-regex semantics remain distinct. |
| Predicate | none, true, false | Evaluated only after type and message acceptance. |
| Group mode | preserve, flatten, allow-unwrapped | Flatten affects group members; unwrapped affects a non-group actual. |
| Pairing | unique, repeated type disambiguated, greedy success, greedy dead-end recoverable, impossible | Alternative flag needs equal counts and a complete unused pairing. |
| Evidence | code, expected index, actual index, actual path | Location fields are checked only for composed failures. |

## State and pairing transitions

Group matching maintains the pairing state `(next expected index, used actual indexes)`. Each expected matcher takes the first unused successful actual item. Failure transitions record unmatched expected and unused actual entries. A separate complete-pairing search determines only the alternative flag; it does not rewrite the required greedy result.

## Integration factors

The frozen factors are actual nesting depth, group mode, matcher kind, filter kind, repeated type, and pairing outcome. Public integration selects canonical nested-path, unwrapped-predicate, and repeated-type combinations. Private integration holds out protocol-only custom matchers, multiple nested prefixes, and call observations. No test assumes a concrete leaf class inside group code.
