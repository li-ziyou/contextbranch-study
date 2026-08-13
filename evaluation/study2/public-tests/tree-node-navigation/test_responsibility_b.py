import pytest

from branching_tree import Node, NodeNotFoundError, NodePath, NotInSameTreeError


def sample_tree():
    return Node.from_mapping({"a": {"x": {}, "y": {}}, "b": {"z": {}}})


def test_resolves_absolute_relative_and_parent_paths():
    # TN-B1, TN-B3
    root = sample_tree()
    x = root.resolve(NodePath("/a/x"))
    assert x.resolve("../y") is root.resolve("/a/y")
    assert x.path == NodePath("/a/x")
    assert x.relative_path_to(root.resolve("b/z")) == NodePath("../../b/z")


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
