# TreeNode test model

## Category-Partition model

| Category | Choices | Constraint |
|---|---|---|
| Operation | attach, detach, replace, orphan, resolve, remove, absolute path, relative path, traversal | Select operations named in the linked requirement. |
| Name | ordinary, empty, dot, parent-dot, contains slash, occupied | Invalid-name choices apply to attach; occupied is valid only for replace. |
| Relationship | orphan, same parent, different parent, self, ancestor, separate tree | Self and ancestor must fail without mutation; separate tree applies to relative path. |
| Path form | absolute, relative, dot, parent, multi-parent, root, missing | Parent above root and missing segments must fail. |
| Tree shape | single node, flat, deep, branched, moved subtree, replaced subtree | Traversal order requires branched shapes. |
| Observation | parent/name, children order, path round trip, traversal tuple, detached subtree | Integration frames combine at least one structural transition and one navigation observation. |

## State transitions

`orphan -> attached`, `attached -> moved`, `attached -> detached`, `occupied -> replaced`, and `valid tree -> rejected operation -> same valid tree` are the required transition families. Each successful transition is observed through both structural properties and live navigation. Each rejected transition compares pre/post links and paths.

## Integration factors

The frozen interaction factors are structural operation, prior relationship, subtree depth, and navigation observation. Public integration uses canonical move, remove, and rejected-cycle combinations. Private integration holds out replacement, detach-reattach, deeper rejected cycles, and nested path removal. This is constrained coverage, not exhaustive Cartesian coverage.
