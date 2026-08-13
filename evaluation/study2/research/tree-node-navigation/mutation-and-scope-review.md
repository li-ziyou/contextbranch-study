# TreeNode mutation and scope review

## Contract-derived mutants

| Mutant | Contract fault | Expected detecting layer |
|---|---|---|
| TN-M1 | Allow attaching an ancestor below its descendant. | A and integration |
| TN-M2 | Move a node without removing its old child entry. | A and integration |
| TN-M3 | Resolve absolute paths from the current node. | B |
| TN-M4 | Return breadth-first descendants instead of depth-first pre-order. | B |
| TN-M5 | Cache a path so a moved subtree keeps its old path. | Integration |

## Alternative implementation scope

Private checks use only exported objects and documented methods. They do not inspect helper functions or source structure. Validation includes the reference implementation plus two equivalent implementation variants: renamed helper decomposition and iterative traversal. Their outcomes are recorded in `../validation-report.md`.

## Scope judgment

Every assertion maps to TN-A1 through TN-I1 in `test-allocation.csv`. Exact error text, copying, equality, thread safety, and upstream file layout are outside scope. Independent human scope review remains an approval gate before formal-study freeze.
