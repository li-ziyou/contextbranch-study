# Task: De-duplicate customer records

You are given lists of customer records that contain several entries for the
same real person (typos, formatting differences, missing fields). Implement
`find_duplicate_groups` in `matcher/solver.py` to group records that refer to
the same person.

## Provided (do not modify)
- `matcher/core.py` — `Record`, and `similarity(a, b, counter)` (every call is
  counted, so fewer calls = lower cost)
- `tests/score.py` — two labelled datasets and a scorer

## You implement
- `matcher/solver.py` — `find_duplicate_groups(records, counter)`

## How you are evaluated
Run the scorer to measure a candidate approach on both datasets:

    python3 -c "from tests.score import score; from matcher.solver import find_duplicate_groups as f; print(score(f,'small_shared')); print(score(f,'large_spread'))"

You are judged on TWO axes at once:
  * f1 — grouping accuracy
  * comparisons — how many similarity() calls you used (lower is better)

Several strategies (compare-all-pairs, block-then-compare, normalize-then-match)
trade accuracy against cost DIFFERENTLY on the two datasets. Which is best is not
obvious in advance — you will likely need to build one, measure it, and compare
it against an alternative before deciding what to ship. The best answer may
combine ideas from more than one.

A quick correctness gate lives in `tests/test_solver.py`:

    python3 -m pytest -q
