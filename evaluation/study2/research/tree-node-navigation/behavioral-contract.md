# TreeNode local behavioral contract

## Pinned source

- FeatureBench instance: `pydata__xarray.97f3a746.test_treenode.aa8ba777.lv1`
- Upstream repository: `pydata/xarray`
- Revision: `97f3a7465a66638f68129581b658853a3992dd89`
- Upstream F2P evidence: `xarray/tests/test_treenode.py`
- Upstream P2P boundary: `xarray/tests/test_deprecation_helpers.py`, `properties/test_encode_decode.py`, `xarray/tests/test_nd_point_index.py`, `xarray/tests/test_coordinates.py`, `xarray/tests/test_print_versions.py`

F2P and P2P identify the source behavior and regression boundary. They are not local participant or grader tests. The local package, ticket, examples, and tests are newly authored.

## Public interface

`Node` owns the shared parent, name, and child state. `NodePath` is a Unix-style path. `structure.py` implements `attach`, `detach`, `replace`, and `orphan`. `navigation.py` implements resolution, path removal, path calculation, and traversal views. The participant may edit only those two implementation files.

## Requirements

| ID | Participant-visible rule | Interface | Observable result | Layer | Upstream evidence |
|---|---|---|---|---|---|
| TN-A1 | `attach` validates names and occupied slots. | `Node.attach` | Valid name attaches; invalid or occupied name raises `InvalidTreeError`. | A | Tree naming and child assignment in source task and F2P file. |
| TN-A2 | Structural edits keep both directions consistent and move complete subtrees. | `attach`, `replace`, `parent`, `name`, `children` | Parent/name/children agree and descendants remain attached. | A | Parent-child reassignment and integrity in source task and F2P file. |
| TN-A3 | Self-links and ancestor cycles are rejected atomically. | `attach`, `replace` | Error leaves both trees unchanged. | A | Cycle prevention and safe modification in source task and F2P file. |
| TN-A4 | Detach, replace, and orphan have stable return/error behavior. | `detach`, `replace`, `orphan` | Returned detached node has no parent/name; missing child raises `NodeNotFoundError`. | A | Node lifecycle behavior in source task and F2P file. |
| TN-B1 | Absolute/relative path resolution supports `.`, `..`, and errors. | `resolve`, `NodePath` | Correct node is returned or `NodeNotFoundError` is raised. | B | Unix-like path access and upward navigation in source task and F2P file. |
| TN-B2 | Path removal detaches a subtree and rejects root removal. | `remove` | Complete subtree is returned detached; root stays present. | B | Path-based access combined with lifecycle operations. |
| TN-B3 | Absolute and relative paths describe live tree locations. | `path`, `relative_path_to` | Round-trip paths work; separate trees raise `NotInSameTreeError`. | B | Bidirectional navigation and Unix-like paths in source task and F2P file. |
| TN-B4 | Traversal views use disclosed tuple order. | `ancestors`, `descendants`, `siblings`, `leaves` | Values are current, depth-first where stated, and insertion ordered. | B | Traversal operations in source task and F2P file. |
| TN-I1 | Navigation immediately reflects structural edits. | Shared `Node`/`NodePath` state | Move, replace, detach, remove, and rejected changes produce consistent paths and traversals. | Integration | Interaction of source task integrity and navigation themes. |

No local check requires copying, equality, thread safety, hidden helper names, exact exception messages, or other source-task behavior absent from the main ticket.
