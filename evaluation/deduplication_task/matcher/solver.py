"""
TASK — YOU IMPLEMENT THIS

Implement `find_duplicate_groups`. Given a list of Records that may contain
several entries for the same real person (with typos, formatting differences,
and partial fields), return the groups of record ids that refer to the same
person.

Return: a list of groups, each a sorted list of record ids. Every id appears in
exactly one group. A record that matches no other is its own group of one.

You have `similarity(a, b, counter)` from matcher.core to compare two field
strings. Two records probably refer to the same person when their names AND
(email OR phone) are sufficiently similar — but the exact thresholds and how you
combine fields are up to you.

You are scored on TWO axes at once (see tests/score.py):
  * ACCURACY — how well your groups match the true grouping.
  * COST — how many similarity() comparisons you used (lower is better).

There are several reasonable strategies and THEY TRADE OFF DIFFERENTLY depending
on the data:
  * Compare all pairs — most accurate, but cost grows with the square of n.
  * Block first (bucket records by a cheap key, only compare within a bucket) —
    much cheaper, but you may miss matches whose key differs.
  * Normalize aggressively then exact-match — cheapest, but risks merging people
    who only look alike after normalization.

Which one gives the best accuracy-for-the-cost is NOT obvious in advance and
depends on the dataset. You will likely need to try one, measure it on the
provided datasets, and compare against another before you know which to ship —
and the best answer may comqbine ideas from more than one.
"""
from __future__ import annotations

from .core import OpCounter, Record


def find_duplicate_groups(records: list[Record], counter: OpCounter) -> list[list[int]]:
    raise NotImplementedError("Implement find_duplicate_groups")
