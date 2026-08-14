"""
PROVIDED SCAFFOLD — do not modify.

Domain types and an instrumented similarity primitive. The `OpCounter` gives a
DETERMINISTIC cost measure (independent of machine speed): every field-level
comparison you make goes through `similarity()`, which increments the counter.
Your solution is scored on BOTH how accurately it groups records AND how few
comparisons it uses. Those two goals pull against each other — that is the point.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Record:
    id: int
    name: str
    email: str
    phone: str


class OpCounter:
    """Counts field comparisons. One shared instance is passed into your solver."""
    def __init__(self) -> None:
        self.comparisons = 0

    def reset(self) -> None:
        self.comparisons = 0


def _norm(s: str) -> str:
    return "".join(ch for ch in s.lower() if ch.isalnum())


def similarity(a: str, b: str, counter: OpCounter) -> float:
    """Normalized character-overlap similarity in [0, 1]. COUNTS as one operation.

    You are free to call this however you like, but every call is counted, so the
    strategy that makes fewer calls has a lower (better) cost. This is the knob
    that makes 'compare all pairs' expensive and 'compare only within a block'
    cheap.
    """
    counter.comparisons += 1
    na, nb = _norm(a), _norm(b)
    if not na and not nb:
        return 1.0
    if not na or not nb:
        return 0.0
    # cheap token/char based Jaccard on character bigrams
    def bigrams(x: str) -> set[str]:
        return {x[i:i + 2] for i in range(len(x) - 1)} or {x}
    ba, bb = bigrams(na), bigrams(nb)
    inter = len(ba & bb)
    union = len(ba | bb)
    return inter / union if union else 0.0
