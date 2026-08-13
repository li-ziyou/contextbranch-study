from __future__ import annotations

from .model import Node, NodeNotFoundError, NodePath, NotInSameTreeError


def _root(node: Node) -> Node:
    while node._parent is not None:
        node = node._parent
    return node


def resolve(node: Node, path: str | NodePath) -> Node:
    path = NodePath(path)
    current = _root(node) if path.is_absolute() else node
    parts = path.parts[1:] if path.is_absolute() else path.parts
    for part in parts:
        if part in {"", "."}:
            continue
        if part == "..":
            if current._parent is None:
                raise NodeNotFoundError(str(path))
            current = current._parent
            continue
        try:
            current = current._children[part]
        except KeyError as error:
            raise NodeNotFoundError(str(path)) from error
    return current


def remove(node: Node, path: str | NodePath) -> Node:
    target = resolve(node, path)
    if target._parent is None:
        raise NodeNotFoundError("The root cannot be removed")
    return target.orphan()


def absolute_path(node: Node) -> NodePath:
    names: list[str] = []
    cursor = node
    while cursor._parent is not None:
        assert cursor._name is not None
        names.append(cursor._name)
        cursor = cursor._parent
    return NodePath("/" + "/".join(reversed(names)))


def relative_path(node: Node, target: Node) -> NodePath:
    if _root(node) is not _root(target):
        raise NotInSameTreeError("Nodes are in separate trees")
    node_lineage = (node, *ancestors(node))
    target_lineage = (target, *ancestors(target))
    common = next(candidate for candidate in node_lineage if candidate in target_lineage)
    up = node_lineage.index(common)
    down_nodes = target_lineage[: target_lineage.index(common)]
    down = [candidate._name for candidate in reversed(down_nodes)]
    parts = [*(".." for _ in range(up)), *(name for name in down if name is not None)]
    return NodePath(*parts) if parts else NodePath(".")


def ancestors(node: Node) -> tuple[Node, ...]:
    result: list[Node] = []
    cursor = node._parent
    while cursor is not None:
        result.append(cursor)
        cursor = cursor._parent
    return tuple(result)


def descendants(node: Node) -> tuple[Node, ...]:
    result: list[Node] = []
    for child in node._children.values():
        result.append(child)
        result.extend(descendants(child))
    return tuple(result)


def siblings(node: Node) -> tuple[Node, ...]:
    if node._parent is None:
        return ()
    return tuple(child for child in node._parent._children.values() if child is not node)


def leaves(node: Node) -> tuple[Node, ...]:
    if not node._children:
        return (node,)
    return tuple(leaf for child in node._children.values() for leaf in leaves(child))
