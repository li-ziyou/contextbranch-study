# Responsibility B: path navigation

- TN-B1: `resolve` supports absolute and relative `NodePath` values, including `.` and `..`, and raises `NodeNotFoundError` for missing segments or movement above the root.
- TN-B2: `remove` resolves a path, detaches that complete subtree, and refuses to remove the root.
- TN-B3: `path` returns an absolute path and `relative_path_to` returns a correct relative path for nodes in the same tree; separate trees raise `NotInSameTreeError`.
- TN-B4: `ancestors`, depth-first pre-order `descendants`, insertion-ordered `siblings`, and depth-first `leaves` reflect the current tree and return tuples.
