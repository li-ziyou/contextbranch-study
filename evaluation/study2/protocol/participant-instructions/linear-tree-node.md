# Participant instructions: Linear + TreeNode

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
