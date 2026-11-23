# Task-test audit and small-model pilot

Audit date is Nov 23, 2026. The source checkout is GitChat 0.4.4 at `3fc391665b427e52997c705c79b5ddeef2375cca`.

## Findings

The current tests are solvable by the supplied reference implementations. There are also test-design issues that obscure completed work or reject valid implementation choices. Use a new task-test version for the candidate changes and compare models on that same version.

| Finding | Evidence | Proposed action |
| --- | --- | --- |
| Four structure tests call `resolve` while preparing nodes | A structure-only reference implementation passes those checks after setup uses the fixed `children` API. All original `assert` and expected-exception blocks are identical. Seven additional submission-by-test passes appear in the paired audit. | Apply the fixture-only diff to the next task version. |
| Matcher tests prescribe callback counts and an eager invocation sequence | The flattened matching test requires both recording matchers to see both actual exceptions. The public contract specifies expected-order greedy pairing, not a full Cartesian evaluation. Seven additional submission-by-test passes appear after accepting the successful delegation without that sequence. One further pass appears after relaxing the single-invocation constraint. | Test the pairing result and required delegation. Permit early stopping on successful pairing. |
| A matcher test compares the complete diagnostic object, including its wording | A reference wrapper adding diagnostic context fails the old check and passes a check retaining failure status, code, cardinality, indexes and path. No additional participant pass appears from this change. | Compare specified fields. If exact diagnostic preservation is intended, first state that contract publicly. |
| Difficult functional checks still detect real defects | Synthetic wrong `EXPECTED_GROUP` handling and an always-true alternative-pairing flag fail both variants. Existing replacement failures include retaining both old and new attachment locations. | Retain these requirements. Improve public failure feedback and repair context. |

These changes are exploratory and were chosen after reviewing previous failure analyses. Their validity should be judged against the task contract and controls. Added passes do not estimate an improvement in the GitChat tool or a model's capability.

## Runs and interpretation

The selected corpus contains 72 final submissions, covering both conditions and task families. The original and candidate suites were run in separate temporary directories, producing 144 participant suite runs. There were 32 reference, incomplete, A-only and B-only control suites across both forms, plus 20 alternative-implementation and defect controls. All control expectations passed. Before/after source hashes matched for 160 original tests and production files.

The fixture changes added seven submission-by-test passes, and the matcher changes added eight. No previously passing case became failing in the paired runs, and no candidate case disappeared. These are counts of outcomes across all submissions and tests, not counts of distinct participants. Counts are reported per original test case in `results.json`.

The combined public/private suite run exits were 128 ordinary failing runs, 12 collection/import-error runs, two timeouts, and two complete passes. The collection failures and timeouts were retained. Per-case counts exclude unexecuted cases, so their denominators can be smaller than the corpus. The suite results are a fresh diagnostic execution of the current bundled tests, not a reproduction of every historical grading policy or runtime environment.

The supplied full reference implementation passed all eight full-suite controls across the two tasks, two forms and two variants. Each A-only or B-only control still failed the full feature suite. Passing one branch and completing the full feature remain different observable outcomes in these fixtures.

The alternative controls used a matcher that stops evaluating after a successful unused match, a predicate wrapper with an extra evaluation, and a matcher that adds diagnostic context. They passed the candidate suite and were rejected by the original incidental assertions. Wrappers returning the wrong unwrapped-input code or always claiming an alternative pairing were rejected by both suites. These controls establish the specific differences between the assertions. They do not establish equivalence for every possible stateful custom matcher.

## Repeated implementation failures

The earlier tree trace includes `replace` leaving both `target` and `source` in the parent's children mapping. This is a real TN-A2/A4 failure. Another trace reaches four structure checks through an unimplemented `resolve`; that preparation dependency is repaired by the fixture-only changes.

The earlier exception-group trace sets `possible_alternative_pairing=True` for a case with no possible type-compatible complete assignment. EG-B4 explicitly requires the alternative complete pairing to exist. Keep the negative case and expose an equivalent diagnostic publicly. EG-B3 likewise requires the option to be enabled and exactly one expected matcher before accepting an unwrapped exception. Splitting its zero/one/multiple-matcher outcomes into diagnostic cases will make follow-up prompts more informative.

For the next public task version, add explicit examples of the unwrapped-input gates and both alternative-pairing outcomes. Record any test grouping or scoring changes in the task version. Do not use a weaker model's failure as the reason to drop a disclosed behavior.

## Model comparison status

The supplied JetBrains LiteLLM URL could not be resolved from the shell. A second network tool request was rejected. The gateway catalog and live generation remain unverified. No API key was available in this process's environment, and no live model ranking was produced.

`pilot.mjs` is prepared to discover the actual gateway aliases and compare up to three user prompts on eight initial branch/form cases. Its local self-check passed using the source checkout's own coding-agent and edit functions. It supports the existing history construction and a compact variant containing the branch ticket, initial request, current files and latest failed assertion. Both variants receive the same branch-owned edit boundary. Per-turn results record finish reasons, rejected edits, scope proposals, test results, model latency and reported usage.

This harness uses synthetic task prompts, fixed public tests and disposable workspaces. It neither sends archived participant prompts nor supplies private tests or reference code to models. A separate evaluator-only private component check after the last turn records whether the candidate satisfies the broader branch requirements. Its first matrix covers initial implementations. Matched late-repair states from the telemetry and checks after deliberate integration are still needed before concluding that a context or model change resolves the reported long-conversation problem.

The next model shortlist must come from the actual authorized gateway catalog. Select the existing baseline, one small coding model, and one intermediate model, then compare identical failing starts and context variants. The selection criteria are branch pass by prompt three, no applied sibling changes, latency and usage. A one-prompt branch completion with a respected boundary is a successful outcome.
