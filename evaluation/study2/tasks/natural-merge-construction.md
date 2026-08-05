# Natural-merge task construction

Study 2 evaluates automatic divide-and-conquer plus participant-controlled
reintegration. A task therefore needs more than two code locations. It needs
two feature contributions that can be implemented independently, remain
isolated while work is in progress, and become a complete user-facing feature
only after both contributions are present in `main`.

## Study task rule

Each task package contains:

1. a stable, prewritten composition layer;
2. exactly two incomplete production modules with non-overlapping allowed
   paths;
3. one public check per module and one public end-to-end check; and
4. three hidden behavioural groups: the two module behaviours and their
   integrated behaviour.

The labels shown by ContextBranch identify the two implementation areas. They
do not prescribe an order, require use of both states, require one patch per
state, or require an integration. In a Linear run, the same labels and all
source files are present in one conversation-code state. In a ContextBranch
run, the system creates two sibling states from the same baseline; the
participant may integrate either state into `main` when it is useful.

## Task pair

| Task | Module A | Module B | Prewritten composition layer | Complete behaviour after integration |
|---|---|---|---|---|
| Markdown Command Template Library | `frontmatter.py`: optional YAML metadata and body | `catalog.py`: recursive discovery and key-based retrieval | `library.py` | list/filter templates and return complete or body-only content |
| RGB Image Composer | `normalization.py`: channel validation and normalization | `encoding.py`: RGB stacking and output conversion | `composer.py` | return a normalized float or 8-bit RGB image |

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
