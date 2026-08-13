import pytest

from branching_tree import InvalidTreeError, Node, NodeNotFoundError, NodePath


def test_moving_subtree_immediately_changes_paths_but_keeps_contents():
    # TN-I1, TN-A2, TN-B1, TN-B3
    root = Node.from_mapping({"left": {"leaf": {}}, "right": {}})
    leaf = root.resolve("left/leaf")
    root.resolve("right").attach("moved", root.resolve("left"))
    assert leaf.path == NodePath("/right/moved/leaf")
    assert root.resolve(leaf.path) is leaf
    with pytest.raises(NodeNotFoundError):
        root.resolve("left/leaf")


def test_path_removal_detaches_the_complete_subtree():
    # TN-I1, TN-A4, TN-B2
    root = Node.from_mapping({"keep": {}, "drop": {"leaf": {}}})
    removed = root.remove("drop")
    assert removed.parent is None and removed.resolve("leaf").path == NodePath("/leaf")
    assert tuple(root.children) == ("keep",)


def test_rejected_cycle_preserves_navigation_results():
    # TN-I1, TN-A3, TN-B3
    root = Node.from_mapping({"a": {"b": {}}})
    before = tuple(node.path for node in (root, *root.descendants))
    with pytest.raises(InvalidTreeError):
        root.resolve("a/b").attach("bad", root)
    assert tuple(node.path for node in (root, *root.descendants)) == before
