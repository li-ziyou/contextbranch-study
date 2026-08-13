# Responsibility A: structure integrity

- TN-A1: `attach` accepts a non-empty child name other than `.` or `..` with no `/`, and rejects an occupied name unless the operation is `replace`.
- TN-A2: `attach` and `replace` maintain consistent `parent`, `name`, and read-only `children` views; attaching an already attached node moves its complete subtree.
- TN-A3: structural operations reject self-links and ancestor cycles without partially changing either tree.
- TN-A4: `detach`, `replace`, and `orphan` return the affected node, clear detached parent/name metadata, and report missing children with `NodeNotFoundError`.
