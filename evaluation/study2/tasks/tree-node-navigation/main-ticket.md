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

## Your responsibilities

The package is split into two connected parts.

### Responsibility A: manage the shape of the tree

Work mainly in `branching_tree/structure.py`.

Make sure that adding, moving, replacing, and removing nodes always leaves a
valid tree. A parent can add a child with a valid name. Moving a node to a new
parent also moves everything below that node. Removing a node disconnects it
from its old parent.

A node cannot become its own child or be moved below one of its descendants.
If an operation is invalid, it must fail without changing the tree. After a
successful change, each node's parent, name, and children must agree with one
another.

### Responsibility B: use the tree as a path-based structure

Work mainly in `branching_tree/navigation.py`.

Let a user find nodes and inspect where they are in the current tree. This
includes finding a node by an absolute path such as `/left/leaf`, finding a
node relative to the current node with `.` and `..`, removing a node by path,
and reporting paths and related nodes.

These results must reflect changes made by Responsibility A. For example, a
node that has been moved must have its new path and new relatives immediately.

## Required behavior

### Responsibility A: manage the shape of the tree

- TN-A1: `attach` accepts a non-empty child name other than `.` or `..` with no `/`, and rejects an occupied name unless the operation is `replace`.
- TN-A2: `attach` and `replace` maintain consistent `parent`, `name`, and read-only `children` views; attaching an already attached node moves its complete subtree.
- TN-A3: structural operations reject self-links and ancestor cycles without partially changing either tree.
- TN-A4: `detach`, `replace`, and `orphan` return the affected node, clear detached parent/name metadata, and report missing children with `NodeNotFoundError`.

### Responsibility B: use the tree as a path-based structure

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
