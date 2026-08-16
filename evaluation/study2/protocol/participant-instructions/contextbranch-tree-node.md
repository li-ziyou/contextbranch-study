# Participant instructions: ContextBranch + TreeNode

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

- **Responsibility A: structure integrity**
- **Responsibility B: path navigation**

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
## Task: TreeNode Structure and Navigation

Implement the missing structural and navigation behavior for the supplied
`branching_tree` package.

### Public interface

The supplied `Node`, `NodePath`, `InvalidTreeError`, `NodeNotFoundError`, and
`NotInSameTreeError` definitions are the shared contract. Do not change
`branching_tree/model.py` or `branching_tree/__init__.py`.

You may edit only:

- `branching_tree/structure.py`
- `branching_tree/navigation.py`

Example:

```python
root = Node.from_mapping({"left": {"leaf": {}}, "right": {}})
leaf = root.resolve(NodePath("/left/leaf"))
```

### Responsibility A: structure integrity

- TN-A1: `attach` accepts a non-empty child name other than `.` or `..` with no `/`, and rejects an occupied name unless the operation is `replace`.
- TN-A2: `attach` and `replace` maintain consistent `parent`, `name`, and read-only `children` views; attaching an already attached node moves its complete subtree.
- TN-A3: structural operations reject self-links and ancestor cycles without partially changing either tree.
- TN-A4: `detach`, `replace`, and `orphan` return the affected node, clear detached parent/name metadata, and report missing children with `NodeNotFoundError`.

### Responsibility B: path navigation

- TN-B1: `resolve` supports absolute and relative `NodePath` values, including `.` and `..`, and raises `NodeNotFoundError` for missing segments or movement above the root.
- TN-B2: `remove` resolves a path, detaches that complete subtree, and refuses to remove the root.
- TN-B3: `path` returns an absolute path and `relative_path_to` returns a correct relative path for nodes in the same tree; separate trees raise `NotInSameTreeError`.
- TN-B4: `ancestors`, depth-first pre-order `descendants`, insertion-ordered `siblings`, and depth-first `leaves` reflect the current tree and return tuples.

### Integration

- TN-I1: all navigation results must immediately reflect successful moves, replacements, detachments, and removals through the shared `Node`/`NodePath` contract.

### Public test commands

```bash
pytest -q tests/test_responsibility_a.py
pytest -q tests/test_responsibility_b.py
pytest -q tests/test_integration.py
pytest -q tests
```
<!-- TASK-CONTENT-END -->
