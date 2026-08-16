# TreeNode Structure and Navigation

## Task

Complete the structure and navigation behavior of the supplied
`branching_tree` package.

## Files You Can Edit

- `branching_tree/structure.py`
- `branching_tree/navigation.py`

Do not modify `branching_tree/model.py` or `branching_tree/__init__.py`.

## Provided API

The supplied `Node`, `NodePath`, `InvalidTreeError`, `NodeNotFoundError`, and
`NotInSameTreeError` definitions are the shared contract.

| API | Result |
| --- | --- |
| `Node.attach(name, child)` | Add or move a child under this node |
| `Node.detach(name)` | Remove and return a child |
| `Node.replace(name, child)` | Replace and return a child |
| `Node.orphan()` | Detach and return this node |
| `Node.resolve(path)` | Return the node at an absolute or relative path |
| `Node.remove(path)` | Detach and return the node at a path |
| `Node.path` | Return this node's absolute `NodePath` |
| `Node.relative_path_to(target)` | Return a relative `NodePath` to another node |
| `ancestors`, `descendants`, `siblings`, `leaves` | Return tuples of related nodes |

## Example

```python
from branching_tree import Node, NodePath

root = Node.from_mapping({"left": {"leaf": {}}, "right": {}})
leaf = root.resolve(NodePath("/left/leaf"))

assert leaf.path == NodePath("/left/leaf")
assert leaf.parent is root.resolve("/left")
assert leaf.resolve("..") is root.resolve("/left")
```

## Requirements

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

## Run Tests

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

## Submission

Submit only the final `main` state. Only code present in `main` is graded.
