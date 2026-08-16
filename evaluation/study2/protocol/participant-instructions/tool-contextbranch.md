# How to use the ContextBranch tool

You have 21 minutes and 40 seconds after you click **Start task**.

Use only this VS Code workspace and the supplied assistant. You may send as
many follow-up messages as you want while time remains. You may accept AI
edits, reject them, or edit the allowed files yourself.

After the task starts, you have `main` and two sibling states. Both siblings
start from the same checkpoint. One focuses on Responsibility A and one on
Responsibility B. Using either sibling, both siblings, or neither is allowed.
You may work in any order.

## Work in a state

1. Before starting, read the separate task sheet, `.study/TASK.md`, the allowed
   files, and the public tests.
2. Click **Start task** when ready.
3. Check the active state name.
4. Write a prompt in your own words and click **Send**.
5. Read the reply and proposed edits.
6. Click **Apply selected** for changes you want, or click **Discard**.
7. Continue in that state or use the state selector to switch.

An AI reply does not change a state's code until you apply its proposed edits.
Manual edits also belong to the active state.

One sibling can continue generating while you switch to the other sibling and
send a prompt there. Two different states can generate at the same time. The
optional **State Map** shows states and integrations but does not change them.

## Test the active state

The test button follows the active state:

- A sibling: **Test A**
- B sibling: **Test B**
- `main`: **Test Main**, which runs A, B, and integration tests

Full output appears in the **Test Results** panel at the bottom of VS Code.
Passing a sibling test does not move that work to `main`.

## Bring sibling work into main

1. Apply or discard pending edits in the sibling.
2. Click **Integrate this state into main** and then **Preview integration**.
3. Review the changed files and conflict notes.
4. If needed, review or revise the AI resolution, or use
   **Resolve conflicts in IDE**.
5. Click **Finalize merge**.
6. Return to `main` and run **Test Main**.

Integration is optional. The preview does not run **Test Main** for you.

## Finish

Return to `main` before finishing. Click **Finish task** when ready. If time
reaches zero first, the tool submits the current `main` automatically. Work
left only in a sibling is not submitted. After **Task finished** appears, stop
editing.

## Tool messages

- **Could not locate the SEARCH anchor:** review the current file. You may use
  **Retry against current file** or write your own follow-up in that state.
- **Output limit reached** or **Repeated edit block:** no edit was applied. You
  may send another follow-up in your own words.
- **Provider error:** you may retry. The timer continues.

Tell the researcher if the workspace or extension stops working. The
researcher can explain controls, but cannot explain how to solve the task.
