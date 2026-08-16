from __future__ import annotations

from .model import InvalidTreeError, Node, NodeNotFoundError


def _validate_name(name: str) -> None:
    if not isinstance(name, str) or not name or name in {".", ".."} or "/" in name:
        raise InvalidTreeError(f"Invalid child name: {name!r}")


def _validate_attachment(parent: Node, name: str, child: Node, *, replacing: bool) -> None:
    _validate_name(name)
    if not isinstance(child, Node):
        raise TypeError("child must be a Node")
    cursor: Node | None = parent
    while cursor is not None:
        if cursor is child:
            raise InvalidTreeError("A node cannot be attached below itself")
        cursor = cursor._parent
    occupying = parent._children.get(name)
    if occupying is not None and occupying is not child and not replacing:
        raise InvalidTreeError(f"A child named {name!r} already exists")
    if child._parent is parent and child._name != name and name in parent._children and not replacing:
        raise InvalidTreeError(f"A child named {name!r} already exists")


def attach(parent: Node, name: str, child: Node) -> None:
    _validate_attachment(parent, name, child, replacing=False)
    if child._parent is parent and child._name == name:
        return
    if child._parent is not None and child._name is not None:
        del child._parent._children[child._name]
    child._parent = parent
    child._name = name
    parent._children[name] = child


def detach(parent: Node, name: str) -> Node:
    if name not in parent._children:
        raise NodeNotFoundError(name)
    child = parent._children.pop(name)
    child._parent = None
    child._name = None
    return child


def replace(parent: Node, name: str, child: Node) -> Node:
    if name not in parent._children:
        raise NodeNotFoundError(name)
    old = parent._children[name]
    if old is child:
        return old
    _validate_attachment(parent, name, child, replacing=True)
    if child._parent is not None and child._name is not None:
        del child._parent._children[child._name]
    old._parent = None
    old._name = None
    child._parent = parent
    child._name = name
    parent._children[name] = child
    return old


def orphan(node: Node) -> Node:
    if node._parent is not None and node._name is not None:
        del node._parent._children[node._name]
        node._parent = None
        node._name = None
    return node
