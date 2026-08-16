# Linear and ContextBranch instruction parity

| Item | Linear | ContextBranch | Experimental difference |
|---|---|---|---|
| Complete ticket | Same frozen main ticket in main | Same frozen main ticket in main | None |
| A/B requirements | Both visible in main | Both visible in main | None |
| Interface and examples | Same | Same | None |
| Initial code and public tests | Same bundle | Same bundle | None |
| Model, limits, editing rights | Same study profile and manifest | Same study profile and manifest | None |
| Follow-up calls | No call or token cap; timer continues | No call or token cap; timer continues | None |
| Edit review and output guards | Same Apply/Discard, anchor retry, output-limit and repetition behavior | Same Apply/Discard, anchor retry, output-limit and repetition behavior | None |
| Working state | One main state | Main and two optional siblings from one checkpoint | State organization only |
| Branch instructions | Not applicable | Literal A or B requirement subset only | Focus label, no new information |
| Order and use | Participant chooses working order | Either, both, neither, or main; any order | None in task obligations |
| Integration | Participant edits main directly | Participant may preview and integrate useful sibling work | State organization only |
| Completion and grading | Final main only | Final main only | None |

Validation enforces that every sibling requirement string occurs verbatim in the main ticket source. The controller contains no recommended merge route and does not force A before B.

The copy-ready tool guides are stored under
`protocol/participant-instructions/`. The task instruction is always the
prepared workspace's `.study/TASK.md`, generated from one frozen main ticket,
so Linear and ContextBranch cannot receive different task wording. The two
tool guides may explain only the controls available in that condition. They
must not add an algorithm, edge case, example, test, or suggested
implementation order.
