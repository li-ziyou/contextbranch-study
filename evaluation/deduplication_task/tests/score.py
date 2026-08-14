"""
PROVIDED SCAFFOLD — do not modify.

Two labelled datasets and a scorer. Each dataset is a list of Records plus the
TRUE grouping (as a list of id-groups). The scorer reports accuracy (pairwise
F1) and cost (similarity comparisons used), and a combined score.

Participants run this to measure a candidate approach. The two datasets are
shaped differently on purpose, so the best strategy on one is not automatically
the best on the other.
"""
from __future__ import annotations

import random

from matcher.core import OpCounter, Record


def _make_dataset(seed: int, n_people: int, dupe_rate: float, typo_rate: float,
                  shared_domain: bool) -> tuple[list[Record], list[list[int]]]:
    rng = random.Random(seed)
    first = ["alex", "sam", "jordan", "casey", "riley", "morgan", "jamie",
             "taylor", "chris", "pat", "drew", "lee", "robin", "sky", "quinn"]
    last = ["smith", "jones", "lee", "brown", "garcia", "davis", "khan",
            "patel", "nguyen", "kim", "lopez", "reed", "hughes", "ford"]
    domains = ["mail.com"] if shared_domain else \
        ["mail.com", "web.io", "corp.net", "home.org", "fastmail.co"]

    records: list[Record] = []
    groups: list[list[int]] = []
    next_id = 0

    def typo(s: str) -> str:
        if not s or rng.random() > typo_rate:
            return s
        i = rng.randrange(len(s))
        return s[:i] + s[min(i + 1, len(s) - 1)] + s[i + 1:]

    for _ in range(n_people):
        fn, ln = rng.choice(first), rng.choice(last)
        base_name = f"{fn} {ln}"
        base_email = f"{fn}.{ln}@{rng.choice(domains)}"
        base_phone = f"555{rng.randrange(1000000, 9999999)}"
        group_ids = []
        copies = 1 + (rng.random() < dupe_rate) + (rng.random() < dupe_rate * 0.5)
        for _c in range(copies):
            records.append(Record(
                id=next_id,
                name=typo(base_name),
                email=typo(base_email),
                phone=base_phone if rng.random() > 0.3 else "",
            ))
            group_ids.append(next_id)
            next_id += 1
        groups.append(sorted(group_ids))

    rng.shuffle(records)
    return records, groups


# Dataset SMALL_SHARED: shared email domain -> blocking on email domain is
# useless (everyone shares it); typos are frequent -> normalization over-merges.
# Favors careful pairwise/name-based comparison.
SMALL_SHARED = _make_dataset(seed=1, n_people=40, dupe_rate=0.6,
                             typo_rate=0.5, shared_domain=True)

# Dataset LARGE_SPREAD: many people, varied domains, fewer typos -> blocking on a
# cheap key is both safe and cheap; all-pairs is wastefully expensive here.
LARGE_SPREAD = _make_dataset(seed=2, n_people=140, dupe_rate=0.5,
                            typo_rate=0.15, shared_domain=False)

DATASETS = {"small_shared": SMALL_SHARED, "large_spread": LARGE_SPREAD}


def _pairs(groups: list[list[int]]) -> set[tuple[int, int]]:
    out = set()
    for g in groups:
        for i in range(len(g)):
            for j in range(i + 1, len(g)):
                out.add((g[i], g[j]))
    return out


def score(solver, dataset_name: str) -> dict:
    records, truth = DATASETS[dataset_name]
    counter = OpCounter()
    predicted = solver(records, counter)

    # validate partition
    seen = [i for g in predicted for i in g]
    all_ids = {r.id for r in records}
    assert sorted(seen) == sorted(all_ids), "output must be a partition of all ids"

    tp_pairs = _pairs([sorted(g) for g in predicted])
    true_pairs = _pairs(truth)
    tp = len(tp_pairs & true_pairs)
    fp = len(tp_pairs - true_pairs)
    fn = len(true_pairs - tp_pairs)
    precision = tp / (tp + fp) if (tp + fp) else 1.0
    recall = tp / (tp + fn) if (tp + fn) else 1.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0

    return {
        "dataset": dataset_name,
        "f1": round(f1, 4),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "comparisons": counter.comparisons,
        "n_records": len(records),
    }
