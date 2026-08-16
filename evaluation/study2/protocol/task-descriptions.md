# Study 2 task descriptions

**Task 1: TreeNode Structure and Navigation**

**This task is derived from the xarray repository. Participants are given a small Python package for maintaining and navigating a mutable tree. The required feature is to attach, move, replace, and detach complete subtrees while keeping parent-child links consistent, prevent invalid cycles, resolve absolute and relative paths, remove nodes by path, and report ancestors, descendants, siblings, and leaves from the current tree.**

**The task has two expected implementation files. The first is `structure.py`, which manages attach, detach, replace, orphan, and structural integrity. The second is `navigation.py`, which resolves paths, removes subtrees, computes absolute and relative paths, and exposes tree traversal views. A provided `model.py` file defines the shared `Node` and `NodePath` contract.**

**Task 2: Exception Group Matcher**

**This task is derived from the pytest repository. Participants are given a small Python package for matching individual exceptions and nested exception groups. The required feature is to match exception types, exact messages or regular expressions, and optional predicates; preserve or flatten nested group boundaries; optionally match an unwrapped exception; pair expected and actual items; and return structured evidence for failures.**

**The task has two expected implementation files. The first is `leaf.py`, which matches individual exceptions and produces leaf-level failure evidence. The second is `groups.py`, which matches nested exception groups, handles flattening and unwrapped exceptions, and reports pairing failures. Provided `contracts.py` and `api.py` files define the shared `Matcher`, `MatchResult`, `MatchEvidence`, and `matches` contract.**
