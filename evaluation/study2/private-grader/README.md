# Clean private grader contract

The grader never executes code from the submitted participant workspace except
for the extracted allowlisted production patch.

For a submitted main state it must:

1. create a fresh worktree at the task's feature-mutation baseline;
2. extract only changes in `submission.allowedProductionPaths` from the
   manifest;
3. apply that patch to the fresh worktree;
4. mount private tests and fixtures outside the participant bundle;
5. run the fixed private command with a fixed timeout; and
6. write `grade.json` containing patch-application status, raw private-check
   results, verified-feature-delivery status, and diagnostics.

Test files, runners, package metadata, configuration, fixtures, and unmerged
candidate states never affect the submitted outcome. This source directory is
private, but its contents are still excluded from participant bundles.
