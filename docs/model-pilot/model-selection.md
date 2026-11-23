# Model selection for the next pilot

Status on November 23, 2026: proposal only. No live model ranking is available because the supplied LiteLLM host cannot be reached from this environment. Gateway aliases and credentials remain unverified. No study default has been changed.

## Existing configuration

The installed source at `3fc391665b427e52997c705c79b5ddeef2375cca` prepares study sessions with `google/gemini-2.5-flash-lite` through OpenRouter unless a model is supplied. This identifies the configured default, not every participant's actual model; use each archived `run.json` for actual attribution. Generic Gemini provider defaults are separate from the study-session default.

The user reports poor experience with the old weak model and one-shot completion with a stronger model. These are the motivation for the pilot, not controlled model-comparison results.

## Proposed comparison

| Role | Candidate | Setting | Reason to include |
| --- | --- | --- | --- |
| Historical reference | Actual existing Flash-Lite alias, only if still available | Existing pinned configuration | Measure whether public-feedback corrections alone change the problem. Do not carry this into new participant sessions based only on price. |
| First middle candidate | Claude Haiku 4.5 | Standard setting; pin the available dated version | Smaller coding model that fits the current request shape more closely. Gateway availability and edit-format behavior still require a smoke test. |
| Configurable newer candidate | Claude Haiku 5.5 | Start at medium effort; compare low only if needed | Official effort controls expose a quality/latency/cost trade-off. Provider compatibility must be addressed before use. |
| Strong reference | The exact model/version that solved the user's task in one shot | Preserve its configuration | Measure whole-task ceiling rather than assuming a model family reproduces that result. |

Haiku 4.5 is an immediate compatibility candidate, not a claim that it is the best current model. For a new long-term deployment, compare Haiku 5.5 after adapting and testing the request path. The provider's official descriptions are external evidence; none establishes performance on GitChat's own tasks.

As checked against official provider pages, Haiku 4.5 is listed at $1 input / $5 output per million tokens. Haiku 5.5 is listed at $0.10 / $0.50 for prompts up to 100,000 tokens, and $0.50 / $2.50 above that. These are direct API list prices, not a quote for JetBrains' gateway or OpenRouter. Lower price does not establish lower capability.

Google's current documentation says `gemini-2.5-flash` is deprecated and will route to `gemini-3.5-flash-lite` starting December 1, 2026. This is the full Flash alias, not evidence that every Flash-Lite endpoint has the same lifecycle. It makes the generic advice “just switch to 2.5 Flash” unsuitable for a new reproducible pilot without checking the actual provider's routing policy.

## Compatibility work before Haiku 5.5

The current native Anthropic provider always sends `temperature`. The Haiku 5.5 migration guide says to omit sampling parameters. It also uses a newer effort configuration, adaptive thinking and different context/token behavior. Changing only the model string is insufficient to claim compatibility. Implement and test model-specific request construction, text-block extraction, output truncation handling and recorded effort/model IDs in a separate production change. The gateway may translate these fields, but that must be verified rather than assumed.

Do not simulate a middle model by starving output tokens or by making users repair truncated responses. Do not change model strength between the Linear and GitChat conditions. Freeze model/version, effort, provider routing and feedback budget together after the pilot.

## What to measure

Measure branch completion and whole-feature completion separately. The desired assistant can implement a focused responsibility reliably; the study still leaves developers meaningful choices about requirements, scope, alternatives and integration. Passing one branch on the first prompt is a successful interaction, not a reason to reject a model.

Use the same source task version (`2026-11-23.1`), files, public feedback and user prompts for every model. Record correctness after prompts one, two and three, final private component validation, whole-feature correctness after deliberate integration, rejected edits, scope violations, latency and reported usage. Include the earlier failing repair states in a later matched replay. Treat service errors and output-format failures separately from algorithmic failures.

If a candidate keeps failing the same local behaviors after useful feedback, it does not meet the reliability goal. If the strong model completes the whole feature immediately in both interaction conditions, investigate task ceiling: realistic requirement choices, interacting changes and regression recovery provide meaningful developer work. Do not choose a failing assistant solely to increase the apparent value of branching.

## Sources

- [Haiku 4.5 release](https://www.anthropic.com/news/claude-haiku-4-5)
- [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Haiku 5.5 release](https://www.anthropic.com/claude-haiku-5-5)
- [Claude effort controls](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Haiku 5.5 migration](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide)
- [Gemini pricing and model lifecycle notice](https://ai.google.dev/gemini-api/docs/pricing)
