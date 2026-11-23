import pytest

from branching_tree import Node, NodeNotFoundError, NodePath, NotInSameTreeError


def sample_tree():
    return Node.from_mapping({"a": {"x": {}, "y": {}}, "b": {"z": {}}})


def test_resolves_absolute_relative_and_parent_paths(form_value):
    # TN-B1, TN-B3
    first = form_value("a", "left")
    x_name = form_value("x", "first")
    y_name = form_value("y", "second")
    second = form_value("b", "right")
    z_name = form_value("z", "leaf")
    root = Node.from_mapping({first: {x_name: {}, y_name: {}}, second: {z_name: {}}})
    x = root.resolve(NodePath(f"/{first}/{x_name}"))
    assert x.resolve(f"../{y_name}") is root.resolve(f"/{first}/{y_name}")
    assert x.path == NodePath(f"/{first}/{x_name}")
    assert x.relative_path_to(root.resolve(f"{second}/{z_name}")) == NodePath(f"../../{second}/{z_name}")


def test_traversal_views_have_the_disclosed_order():
    # TN-B4
    root = sample_tree()
    a, x, y, b, z = (root.resolve(path) for path in ("a", "a/x", "a/y", "b", "b/z"))
    assert root.descendants == (a, x, y, b, z)
    assert x.ancestors == (a, root)
    assert x.siblings == (y,)
    assert root.leaves == (x, y, z)


def test_navigation_errors_are_explicit():
    # TN-B1, TN-B3
    root = sample_tree()
    with pytest.raises(NodeNotFoundError):
        root.resolve("../outside")
    with pytest.raises(NotInSameTreeError):
        root.relative_path_to(Node())


from branching_tree import Node
from branching_tree import structure


def test_remove_detaches_the_resolved_subtree(monkeypatch):
    # TN-B2: supply the sibling responsibility's detach/orphan dependency.
    def detach(parent, name):
        child = parent._children.pop(name)
        child._parent = child._name = None
        return child

    def orphan(node):
        return detach(node.parent, node.name) if node.parent is not None else node

    monkeypatch.setattr(structure, "detach", detach)
    monkeypatch.setattr(structure, "orphan", orphan)
    root = Node.from_mapping({"keep": {}, "branch": {"leaf": {}}})
    target = root.children["branch"]
    leaf = target.children["leaf"]
    assert root.remove("branch") is target
    assert tuple(root.children) == ("keep",)
    assert target.parent is None
    assert target.name is None
    assert target.children["leaf"] is leaf
    assert leaf.parent is target
