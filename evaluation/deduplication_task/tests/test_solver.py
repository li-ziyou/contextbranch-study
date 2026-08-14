"""Minimal correctness gate: solution must return a valid partition and beat
trivial baselines. It does NOT prescribe a strategy or a target score — the
'real' evaluation is the two-axis score in score.py that participants optimize.
"""
import pytest
from matcher.core import OpCounter
from matcher.solver import find_duplicate_groups
from tests.score import score, DATASETS


def test_returns_valid_partition():
    records, _ = DATASETS["small_shared"]
    counter = OpCounter()
    groups = find_duplicate_groups(records, counter)
    seen = sorted(i for g in groups for i in g)
    assert seen == sorted(r.id for r in records)


def test_beats_trivial_singletons_on_accuracy():
    # A solution that groups nothing gets f1 ~0; a real attempt must do better.
    result = score(find_duplicate_groups, "small_shared")
    assert result["f1"] > 0.3, "should find at least some true duplicates"
