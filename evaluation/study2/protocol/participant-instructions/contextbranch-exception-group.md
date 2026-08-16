# Participant instructions: ContextBranch + Exception Group

You will implement one feature in a small Python package. You have 21 minutes
and 40 seconds after you click **Start task**.

## Rules

- Use only this VS Code workspace and the supplied ContextBranch assistant.
- Do not use another AI assistant or an online solution.
- You may read all supplied code and public tests.
- You may send as many follow-up messages as you want while time remains.
- You may accept AI edits, reject them, or edit the allowed files yourself.
- Using either sibling state, both sibling states, or neither is allowed.
- Only the final code in `main` is submitted.
- The research team will run separate checks after the session. You will not see
  those checks during the task.

## Before you start the timer

1. Read the complete ticket in `.study/TASK.md`. The same ticket will appear in
   `main` after the task starts.
2. Open the two files that you may edit.
3. Read the public tests if useful.
4. Ask the researcher only about the controls, not how to solve the task.
5. Click **Start task** when you are ready.

## The available states

After the task starts, the tool creates two sibling states from the same
starting checkpoint:

- **Responsibility A: leaf matching**
- **Responsibility B: nested group matching**

`main` keeps the complete ticket. Each sibling shows only the matching part of
the same ticket. It does not add new requirements or hints.

You choose how to work. You may start in `main`, start in either sibling, use
only one sibling, use both in any order, or ignore them. The **State Map** is an
optional view of the states and integrations. It is view-only. Use the state
selector to change the active state.

## How to work in a state

1. Check the active state name.
2. Write a prompt in your own words and click **Send**.
3. Read the reply and the proposed edits.
4. Select the changes you want and click **Apply selected**, or click
   **Discard**.
5. Continue with another prompt, edit the code yourself, run the current
   state's tests, or switch state.

An AI reply does not change that state's code until you apply its proposed
edits. Check the file name and change before applying it. Manual edits belong
to the active state, so check the state name before editing.

One sibling may continue generating while you switch to the other sibling and
send a prompt there. Two states can generate at the same time. You cannot send
two prompts at the same time in one state. You may switch back later to review
each result.

## Tests

The one test button follows the active state:

- In the A sibling, **Test A** runs Responsibility A public tests.
- In the B sibling, **Test B** runs Responsibility B public tests.
- In `main`, **Test Main** runs A, B, and integration public tests.

Full output appears in the **Test Results** panel at the bottom of VS Code.
Passing A or B inside a sibling does not submit that work and does not prove
that `main` passes.

## Bring sibling work into main

To use work from the active sibling:

1. Apply or discard any pending edits in that sibling.
2. Click **Integrate this state into main**.
3. Click **Preview integration**.
4. Review the changed files and any rebase or conflict notes.
5. If there is no conflict, click **Finalize merge**.
6. If there is a conflict, review an AI-proposed resolution if one is shown.
   You may accept it, ask the AI to revise it, or click
   **Resolve conflicts in IDE** and resolve the marked file yourself.
7. Return to `main` and click **Test Main**.

The integration preview does not run the final public suite. Run **Test Main**
yourself. After a sibling is integrated, it becomes a completed state. Do any
more work in `main` or another active sibling.

## If a tool message appears

- **Could not locate the SEARCH anchor:** the file no longer matches the edit.
  Review the current file. If **Retry against current file** is shown, you may
  use it. You may also write your own follow-up in that state.
- **Output limit reached:** the partial answer was not applied. You may send a
  smaller follow-up in your own words.
- **Repeated edit block:** generation was stopped and no edit was applied. You
  may send a smaller follow-up.
- **Provider error:** you may retry. The task timer continues.

Do not reload or close VS Code to change states or fix a model reply. Tell the
researcher if the workspace or extension itself stops working.

## Finish

Before finishing, switch to `main` and review the final code. Click
**Test Main** if useful. Click **Finish task** when you want to submit. The
button waits for active model responses and tests to end. If time reaches zero
first, the tool submits the current `main` automatically. Work left only in a
sibling is not submitted.

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
