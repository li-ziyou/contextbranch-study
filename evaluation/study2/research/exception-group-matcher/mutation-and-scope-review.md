# Exception Group mutation and scope review

## Contract-derived mutants

| Mutant | Contract fault | Expected detecting layer |
|---|---|---|
| EG-M1 | Use exact equality instead of `isinstance`. | A |
| EG-M2 | Use regex full match instead of search. | A |
| EG-M3 | Flatten only one nested level. | B and integration |
| EG-M4 | Ignore unexpected actual items after all expected items pair. | B |
| EG-M5 | Drop child failure codes or nested paths during group composition. | Integration |

## Alternative implementation scope

Private checks call only the public protocol and exported classes. They include a custom `Matcher` to prevent dependence on `LeafMatcher` internals. Validation includes the reference implementation plus two equivalent variants: reordered helper decomposition and iterative flatten/pairing helpers. Their outcomes are recorded in `../validation-report.md`.

## Scope judgment

Every assertion maps to EG-A1 through EG-I1 in `test-allocation.csv`. Exact diagnostic text, repr, context management, private fields, and pytest's source layout are outside scope. Independent human scope review remains an approval gate before formal-study freeze.
