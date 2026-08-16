# Study 2 v2 task implementation specification

## Task set

`study2-v2` contains `tree-node-navigation` and `exception-group-matcher`. `legacy` retains `markdown-command-template-library` and `rgb-image-composer`. The operator chooses a set with `--task-set` or `CONTEXTBRANCH_STUDY_TASK_SET`; the default is `study2-v2`.

## Common participant shape

Each bundle contains one complete English ticket, the same incomplete package, and three public files named `test_responsibility_a.py`, `test_responsibility_b.py`, and `test_integration.py`. The only editable production paths are the two responsibility modules. Shared interfaces are supplied and outside the allowlist.

Linear receives one main conversation-code-evidence state. ContextBranch receives main plus two optional sibling states created from the same checkpoint. Sibling tickets are literal subsets of the main ticket, contain no examples or commands, and impose no order. Only main is finished, exported, collected, and clean graded.

## TreeNode

- Responsibility A: `branching_tree/structure.py`
- Responsibility B: `branching_tree/navigation.py`
- Shared contract: `branching_tree/model.py` exports `Node` and `NodePath`
- Clean goals: `structure_integrity`, `path_navigation`, `tree_integration`

## Exception Group

- Responsibility A: `exception_matcher/leaf.py`
- Responsibility B: `exception_matcher/groups.py`
- Shared contract: `contracts.py` exports `Matcher`, `MatchResult`, `MatchEvidence`, and `FailureCode`
- Clean goals: `leaf_matching`, `group_matching`, `matcher_integration`

## Grading and export

The clean grader copies only the two allowlisted files onto the private incomplete baseline. It runs each hidden goal separately, reports per-goal verification, and computes overall correctness as their conjunction. Public tests and participant metadata are not copied. The participant ZIP contains session metadata, the public ticket, ContextBranch state data, and the two final-main production files; private tests, references, `.git`, runtime secrets, and the source workspace are excluded.
