# TreeNode Structure and Navigation

Implement the missing structural and navigation behavior for the supplied `branching_tree` package.

## Public interface

The supplied `Node`, `NodePath`, `InvalidTreeError`, `NodeNotFoundError`, and `NotInSameTreeError` definitions are the shared contract. Do not change `branching_tree/model.py` or `branching_tree/__init__.py`.

You may edit only:

- `branching_tree/structure.py`
- `branching_tree/navigation.py`

Example use of the supplied interface:

```python
root = Node.from_mapping({"left": {"leaf": {}}, "right": {}})
leaf = root.resolve(NodePath("/left/leaf"))
```

## Acceptance requirements

### Responsibility A: structure integrity

- TN-A1: `attach` accepts a non-empty child name other than `.` or `..` with no `/`, and rejects an occupied name unless the operation is `replace`.
- TN-A2: `attach` and `replace` maintain consistent `parent`, `name`, and read-only `children` views; attaching an already attached node moves its complete subtree.
- TN-A3: structural operations reject self-links and ancestor cycles without partially changing either tree.
- TN-A4: `detach`, `replace`, and `orphan` return the affected node, clear detached parent/name metadata, and report missing children with `NodeNotFoundError`.

### Responsibility B: path navigation

- TN-B1: `resolve` supports absolute and relative `NodePath` values, including `.` and `..`, and raises `NodeNotFoundError` for missing segments or movement above the root.
- TN-B2: `remove` resolves a path, detaches that complete subtree, and refuses to remove the root.
- TN-B3: `path` returns an absolute path and `relative_path_to` returns a correct relative path for nodes in the same tree; separate trees raise `NotInSameTreeError`.
- TN-B4: `ancestors`, depth-first pre-order `descendants`, insertion-ordered `siblings`, and depth-first `leaves` reflect the current tree and return tuples.

### Integration

- TN-I1: all navigation results must immediately reflect successful moves, replacements, detachments, and removals through the shared `Node`/`NodePath` contract.

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
