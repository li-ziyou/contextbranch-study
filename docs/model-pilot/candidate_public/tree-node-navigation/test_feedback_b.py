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
