import pytest

from branching_tree import InvalidTreeError, Node, NodeNotFoundError


def test_attach_move_and_replace_keep_bidirectional_state():
    # TN-A1, TN-A2, TN-A4
    left, right, child, replacement = Node(), Node(), Node(), Node()
    left.attach("item", child)
    right.attach("moved", child)
    assert left.children == {}
    assert right.children["moved"] is child
    assert (child.parent, child.name) == (right, "moved")
    old = right.replace("moved", replacement)
    assert old is child and old.parent is None and old.name is None
    assert replacement.parent is right


def test_rejected_cycle_is_atomic():
    # TN-A3
    root = Node.from_mapping({"a": {"b": {}}})
    a = root.children["a"]
    b = a.children["b"]
    with pytest.raises(InvalidTreeError):
        b.attach("root", root)
    assert root.children["a"].children["b"] is b
    assert (root.parent, a.parent, b.parent) == (None, root, a)


def test_detach_reports_missing_and_children_view_is_read_only():
    # TN-A2, TN-A4
    root = Node.from_mapping({"leaf": {}})
    with pytest.raises(TypeError):
        root.children["other"] = Node()
    leaf = root.detach("leaf")
    assert leaf.parent is None and leaf.name is None
    with pytest.raises(NodeNotFoundError):
        root.detach("missing")
