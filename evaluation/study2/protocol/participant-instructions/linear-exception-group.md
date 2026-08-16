# Participant instructions: Linear + Exception Group

You will implement one feature in a small Python package. You have 21 minutes
and 40 seconds after you click **Start task**.

## Rules

- Use only this VS Code workspace and the supplied ContextBranch assistant.
- Do not use another AI assistant or an online solution.
- You may read all supplied code and public tests.
- You may send as many follow-up messages as you want while time remains.
- You may accept AI edits, reject them, or edit the allowed files yourself.
- Only the final code in `main` is submitted.
- The research team will run separate checks after the session. You will not see
  those checks during the task.

## Before you start the timer

1. Read `.study/TASK.md`.
2. Open the two files that you may edit.
3. Read the public tests if useful.
4. Ask the researcher only about the controls, not how to solve the task.
5. Click **Start task** when you are ready.

## How to use the Linear tool

Linear has one conversation and one code state named `main`. Both
responsibilities belong to the same task. You may work on them in any order.

1. Write a prompt in your own words and click **Send**.
2. Read the reply and the proposed edits.
3. Select the changes you want and click **Apply selected**, or click
   **Discard**.
4. Continue with another prompt, edit the code yourself, or run tests.
5. Use test output to decide your own next step.

An AI reply does not change the code until you apply its proposed edits. Check
the file name and change before applying it.

## Tests

Click **Test Main** to run all public tests for Responsibility A,
Responsibility B, and integration. Full output appears in the **Test Results**
panel at the bottom of VS Code.

You may also run the commands listed in `.study/TASK.md`. Public tests are
evidence for your work, but passing them does not reveal the later checks.

## If a tool message appears

- **Could not locate the SEARCH anchor:** the file no longer matches the edit.
  Review the current file. If **Retry against current file** is shown, you may
  use it. You may also write your own follow-up.
- **Output limit reached:** the partial answer was not applied. You may send a
  smaller follow-up in your own words.
- **Repeated edit block:** generation was stopped and no edit was applied. You
  may send a smaller follow-up.
- **Provider error:** you may retry. The task timer continues.

Do not reload or close VS Code to fix a model reply. Tell the researcher if the
workspace or extension itself stops working.

## Finish

Click **Finish task** when you want to submit. The button waits for any active
model response or test run to end. If time reaches zero first, the tool submits
the current `main` automatically.

After the tool says **Task finished**, stop editing.

<!-- TASK-CONTENT-START -->
## Task: Exception Group Matcher

Implement the missing leaf and group matching behavior for the supplied
`exception_matcher` package.

### Public interface

The supplied `FailureCode`, `MatchEvidence`, `MatchResult`, `Matcher`, and
`matches` definitions are the shared contract. Do not change
`exception_matcher/contracts.py`, `exception_matcher/api.py`, or
`exception_matcher/__init__.py`.

You may edit only:

- `exception_matcher/leaf.py`
- `exception_matcher/groups.py`

Example:

```python
expected = GroupMatcher([LeafMatcher(ValueError, "bad value")])
result = matches(expected, ExceptionGroup("errors", [ValueError("bad value")]))
```

### Responsibility A: leaf matching

- EG-A1: `LeafMatcher` matches a leaf exception by `isinstance` against one type or a tuple of types and rejects exception groups as leaves.
- EG-A2: an optional string requires an exact exception message, an optional compiled regular expression uses `search`, and an optional predicate must return true.
- EG-A3: every leaf mismatch returns an unmatched `MatchResult` with the corresponding `FailureCode`; successful matches contain no failure evidence.

### Responsibility B: nested group matching

- EG-B1: `GroupMatcher` preserves nested group boundaries by default, so a nested group is matched by a nested matcher rather than by a leaf matcher.
- EG-B2: `flatten=True` recursively exposes leaves for matching while retaining each leaf's original index path in failure evidence.
- EG-B3: `allow_unwrapped=True` delegates a non-group exception only when there is exactly one expected matcher; otherwise a group is required.
- EG-B4: expected matchers pair in expected order with the first still-unmatched successful actual item; failures report unmatched expected and unexpected actual items and flag when another complete pairing exists.

### Integration

- EG-I1: group matching consumes the shared `Matcher`/`MatchResult` contract and preserves leaf failure codes together with expected indexes, actual indexes, and nested actual paths.

### Public test commands

```bash
pytest -q tests/test_responsibility_a.py
pytest -q tests/test_responsibility_b.py
pytest -q tests/test_integration.py
pytest -q tests
```
<!-- TASK-CONTENT-END -->
