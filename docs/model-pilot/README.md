# Task-test correction and small-model pilot

This is a review package for a new task-test version. It does not update the active manifests, installed extension, participant bundles, or historical scores. See [issue 13](https://github.com/li-ziyou/contextbranch-study/issues/13) for the earlier task audit.

The source used for execution was `3fc391665b427e52997c705c79b5ddeef2375cca` (GitChat 0.4.4), rather than remote main `3187de61bee64f078900332e6b9c50d47257aa59`. Use `--source`/`--study` to point to that checkout and its existing Python environment. The proposal is isolated under this directory so it can be reviewed independently of the installed study branch.

## Findings and proposed changes

| Requirement | Problem or missing feedback | Review candidate |
| --- | --- | --- |
| TN-A structural behavior | Four private structure tests call unfinished navigation while preparing nodes. | Use the fixed `children` mapping for setup; preserve all assertions and exception checks. |
| EG-B4, EG-I1 | A successful flattened match must call every matcher on every exception in one specific order under the old assertion. The public requirement specifies greedy pairing and delegation. | Require delegation on the original matching exception objects and retain all other pairing, evidence and path tests. Permit stopping after a successful available match. |
| EG-A3 | A successful leaf result carrying failure evidence passes the old suite. | Add five separate public success checks for type, tuple, exact message, regular expression and predicate. |
| EG-B3 | Flag-disabled, zero-matcher and multiple-matcher outcomes share coarse feedback. | Add separate public rejection cases and a custom matcher delegation case. |
| EG-B4 | The public check exposes the recoverable greedy case but not an impossible complete pairing. | Expose both cases; retain the full matching requirement. |
| TN-B2 | An unimplemented `remove` passes the existing B public checks. | Add a focused subtree-removal check with controlled sibling detach/orphan dependencies. Full integration checks continue to use actual implementations. |

The narrower proposal deliberately leaves callback-count assertions and exact unwrapped diagnostic forwarding unchanged. Callbacks may be stateful; relaxing their invocation counts needs its own contract decision. `report.md` and `results.json` describe an earlier, broader exploratory variant that relaxed these constraints. Its 15 added submission-by-test passes must not be attributed to this narrower candidate. The current narrower result is in `verified-minimal/summary.json`.

`candidate_v3.py` constructs two variants in temporary workspaces. `minimal` corrects only structure setup and the eager-matrix assertion. `proposed` adds public feedback to those corrections. Neither changes the original bundles. `verified-v3/proposed-diffs/` contains concrete full diffs for review. Changing the active study materials requires a new frozen version and regenerated asset hashes; this package does not do that implicitly.

## Validation

`verify_v3.py` checks both task forms. All 76 expected suite outcomes were verified, with 40 original Python files unchanged. Full references pass all variants. Independent A and B branches pass their local proposed checks; the original tree A check fails because of its navigation setup dependency. Empty baselines remain failing. An implementation that stops after successful available matches passes the proposed suite and fails the original eager-order assertion. A callback invoked twice is still rejected.

Two concrete missing-check controls are distinguished: success with failure evidence passes the original full matcher suite but fails the proposed suite; an unimplemented remove passes the original B public checks but fails the proposed check. An always-true alternative-pairing flag remains rejected. These results check the stated differences, not equivalence for every possible custom matcher.

The historical audit covers 72 final submissions. The narrower `minimal` correction adds 14 submission-by-test passes (seven structure outcomes and seven flattened-matcher outcomes), with no previously passing case regressing and no missing candidate case. Collection errors and timeouts are reported separately and are not treated as ordinary failed assertions. Outcome changes are exploratory diagnostic results, not new participant scores or causal evidence about GitChat. This historical replay does not include the newly added public diagnostics; `verify_v3.py` validates those with reference and defect controls.

```sh
STUDY_SOURCE=/absolute/path/to/contextbranch-study
STUDY_ANALYSIS=/absolute/path/to/contextbranch-study-analysis
STUDY_PYTHON="$STUDY_SOURCE/.study-runtime/bin/python"

"$STUDY_PYTHON" docs/model-pilot/verify_v3.py \
  --study "$STUDY_SOURCE" --python "$STUDY_PYTHON" \
  --out /tmp/gitchat-candidate-validation

node docs/model-pilot/pilot.mjs --self-test --source "$STUDY_SOURCE"
```

## Live model comparison

No live-model scores are available. On November 23, 2026, the shell and pilot could not resolve `litellm.labs.jb.gg` (`ENOTFOUND`); the web access tool also could not open it. No gateway credential was present in the process environment. No model catalog was retrieved, no generation request succeeded, and no model is selected from this work.

Set the approved gateway URL and API credential in `LITELLM_PROXY_URL` and `LITELLM_API_KEY`. The harness reads the credential without printing it. Do not put credentials in this repository or an issue.

```sh
node docs/model-pilot/pilot.mjs --list

# One branch/form, at most three generation requests.
node docs/model-pilot/pilot.mjs --source "$STUDY_SOURCE" --python "$STUDY_PYTHON" \
  --model ACTUAL_GATEWAY_ALIAS --task exception-group-matcher --side B --form F1 \
  --context history --turns 3 --repeats 1 --grading proposed \
  --out /tmp/gitchat-model-connectivity.jsonl

# Matched matrix after connectivity succeeds, at most 288 requests.
node docs/model-pilot/pilot.mjs --source "$STUDY_SOURCE" --python "$STUDY_PYTHON" \
  --model BASELINE_ALIAS --model SMALL_CODER_ALIAS --model INTERMEDIATE_ALIAS \
  --context history --context compact --turns 3 --repeats 2 \
  --grading proposed --max-tokens 16384 --out /tmp/gitchat-model-matrix.jsonl
```

Choose only aliases in the actual catalog. The existing Flash-Lite baseline, an available small coding model, and one intermediate model are comparison roles, not a ranking or verified availability claim. Pin the same model and output allowance across context conditions. The default `proposed` grading supplies the new public checks during repair and the corresponding private component check only after the final turn. `original` uses the old suites. `candidate` selects the earlier broad exploratory variant; do not use it as the final test-contract decision.

The real coding agent constructs messages and the real parser applies SEARCH/REPLACE edits. At most three user prompts are allowed per case. All edits are restricted to the owned responsibility file. Private tests and references never enter model messages. Recorded outcomes include pass by prompt, edit rejection, sibling edit proposals, provider errors, reported model ID, latency and token usage. Whole-feature integration and archived late-repair replay remain follow-up checks. This harness does not reproduce the VS Code UI or its automatic-repair policy.

## Codex follow-up task

**Goal.** Select a model using measured branch completion within three user prompts and publish a separately versioned task-test correction.

**Context.** Local test defects can obscure progress; real implementation bugs remain. Live testing is blocked by gateway access. The installed source and remote main differ, so record the source ref for every result.

**Scope.** Review the proposed diffs, resolve the gatekeeper access, run the matched model matrix, and add at least four sanitized failing late-repair states for a matched replay. Compare history and compact context with identical starting files. Validate integration after a deliberate merge.

**Non-scope.** Changing frozen historical scores, removing disclosed requirements to help a weak model, sending participant conversations or private tests to the gateway, or deploying an unversioned test change.

**Files to inspect.** `src/agents/coding.ts`, `src/llm/prompts.ts`, `src/core/edits.ts`, `src/webview/webview-manager.ts`, `evaluation/study2/tasks/`, `evaluation/study2/public-tests/`, `evaluation/study2/private-grader/checks/`, the task manifest/builders, and this package.

**Steps.** Discover authorized aliases; pass a one-case connectivity run; run the same cases and budgets across model/context conditions; replay identical failing repair states; validate the proposed requirement-to-test map; regenerate a new frozen task version only after review.

**Acceptance.** Report per-case pass by prompts 1, 2 and 3, private component validation, unresolved failures, sibling edits proposed/applied, format and anchor failures, provider errors, latency and usage. A one-prompt scoped completion counts as success. Preserve historical grading provenance. State all unavailable comparisons explicitly.

**Tests.** Run `verify_v3.py` and the pilot self-check. For production source edits, also run existing context-freshness, edit-recovery, output-limit and output-guard checks. Verify integration, new task hashes and packaging before deployment.

**Final report.** Provide the issue/PR, diff, exact test output and source/version refs, per-case model results, task-version decision, and remaining gaps in the PR or `docs/codex-report.md`.
