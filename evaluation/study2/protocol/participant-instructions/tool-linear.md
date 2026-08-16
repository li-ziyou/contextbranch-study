# How to use the Linear tool

You have 21 minutes and 40 seconds after you click **Start task**.

Use only this VS Code workspace and the supplied assistant. You may send as
many follow-up messages as you want while time remains. You may accept AI
edits, reject them, or edit the allowed files yourself.

Linear has one conversation and one code state named `main`.

## Work on the task

1. Before starting, read the separate task sheet, `.study/TASK.md`, the allowed
   files, and the public tests.
2. Click **Start task** when ready.
3. Write a prompt in your own words and click **Send**.
4. Read the reply and proposed edits.
5. Click **Apply selected** for changes you want, or click **Discard**.
6. Continue with another prompt, edit the code yourself, or run tests.

An AI reply does not change the code until you apply its proposed edits.

## Test and finish

Click **Test Main** to run all public tests. Full output appears in the
**Test Results** panel at the bottom of VS Code.

Click **Finish task** when ready. If time reaches zero first, the tool submits
the current `main` automatically. After **Task finished** appears, stop editing.

Only final `main` is submitted. Later checks are not visible during the task.

## Tool messages

- **Could not locate the SEARCH anchor:** review the current file. You may use
  **Retry against current file** or write your own follow-up.
- **Output limit reached** or **Repeated edit block:** no edit was applied. You
  may send another follow-up in your own words.
- **Provider error:** you may retry. The timer continues.

Tell the researcher if the workspace or extension stops working. The
researcher can explain controls, but cannot explain how to solve the task.
