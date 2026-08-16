# Natural-merge task construction

Study 2 evaluates automatic divide-and-conquer plus participant-controlled
reintegration. A task therefore needs more than two code locations. It needs
two feature contributions that can be implemented independently, remain
isolated while work is in progress, and become a complete user-facing feature
only after both contributions are present in `main`.

## Study task rule

Each task package contains:

1. a stable, prewritten composition layer;
2. exactly two incomplete production responsibilities in separate folders with non-overlapping allowed
   paths;
3. one public check per module and one public end-to-end check; and
4. three hidden behavioural groups: the two module behaviours and their
   integrated behaviour.

The main ContextBranch state keeps the total feature ticket. Each sibling
receives only the matching responsibility requirements copied from that
ticket, without added examples, commands, algorithms, or suggested order. In a Linear run, the participant receives
the total feature ticket and all source files in one conversation-code state.
In a ContextBranch run, the system creates two sibling states from the same
checkpoint; the participant may use either state, both, neither, or main in
any order, and may integrate a state into `main` when it is useful.

## Task pair

| Task | Module A | Module B | Prewritten composition layer | Complete behaviour after integration |
|---|---|---|---|---|
| Scoped Markdown Command Library | `metadata/frontmatter.py`: parsed metadata data contract and validation | `catalog/index.py`: recursive index and safe key lookup | `library.py` | filter, retrieve, and render indexed templates |
| Configurable RGB Image Composer | `transforms/channel_transform.py`: aligned-channel interval and stretch contract | `output/encoder.py`: RGB stacking and output encoding contract | `composer.py` | return a transformed float or 8-bit RGB image |

The two themes retain traceable links to the MLflow and Astropy FeatureBench
instances recorded in their manifests. The task packages are intentionally
curated for the study rather than literal reproductions of the reference
patches. This makes the experiment's unit of treatment, isolated and later
reintegrated implementation work, explicit and reproducible.

## Evaluation boundary

The clean grader copies only the two allowed implementation modules from the
final `main` state onto a fresh incomplete baseline. It then runs the hidden
behavioural checks. Edits to the composition layer, public tests, runner, or
other files cannot make a submission pass. The output is a binary verified
feature-delivery result plus per-goal evidence; branch and merge counts remain
process traces, not scoring inputs.
