import pytest

from branching_tree import InvalidTreeError, Node, NodeNotFoundError, NodePath


def test_replace_updates_traversal_paths_and_detached_subtree_root():
    # TN-I1, TN-A4, TN-B3, TN-B4
    root = Node.from_mapping({"slot": {"old": {}}, "incoming": {"new": {}}})
    incoming = root.resolve("incoming")
    old = root.replace("slot", incoming)
    assert [node.path for node in root.descendants] == [NodePath("/slot"), NodePath("/slot/new")]
    assert old.path == NodePath("/") and old.resolve("old").path == NodePath("/old")


def test_detach_then_reattach_changes_relative_navigation_consistently():
    # TN-I1, TN-A2, TN-A4, TN-B1, TN-B3
    root = Node.from_mapping({"a": {"moving": {"leaf": {}}}, "b": {}})
    moving = root.resolve("a").detach("moving")
    assert moving.resolve("leaf").path == NodePath("/leaf")
    root.resolve("b").attach("arrived", moving)
    leaf = root.resolve("b/arrived/leaf")
    assert leaf.relative_path_to(root.resolve("a")) == NodePath("../../../a")


def test_failed_cycle_preserves_all_links_and_paths():
    # TN-I1, TN-A3, TN-B1, TN-B4
    root = Node.from_mapping({"top": {"mid": {"bottom": {}}}, "other": {}})
    nodes = (root, *root.descendants)
    snapshot = [(node.parent, node.name, node.path, tuple(node.children)) for node in nodes]
    with pytest.raises(InvalidTreeError):
        root.resolve("top/mid/bottom").attach("cycle", root.resolve("top"))
    assert [(node.parent, node.name, node.path, tuple(node.children)) for node in nodes] == snapshot


def test_path_removal_invalidates_old_location_and_keeps_removed_subtree():
    # TN-I1, TN-A4, TN-B1, TN-B2
    root = Node.from_mapping({"remove": {"x": {"y": {}}}, "keep": {}})
    removed = root.remove(NodePath("/remove/x"))
    with pytest.raises(NodeNotFoundError):
        root.resolve("remove/x")
    assert removed.resolve("y").parent is removed
    assert removed.path == NodePath("/")
