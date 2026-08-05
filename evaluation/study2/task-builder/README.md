# Task builder contract

The builder converts each pinned FeatureBench source revision into two separate
outputs:

1. a participant bundle containing a sanitized feature-mutation baseline,
   ticket, readable public tests, and a public runner; and
2. a private grader package containing the same clean mutation baseline,
   allowlisted production paths, hidden tests, and fixed fixtures.

The participant bundle must not contain the upstream Git history, FeatureBench
patch, target test file, source solution, private test code, grader fixtures,
or any remote origin. The task repository is re-initialized with only study
commits before distribution.

For each task, the builder must prove:

- the mutation baseline fails the intended public test;
- the reference repair passes public and private tests;
- a near-miss implementation can be distinguished by private checks;
- a participant modification to tests, runner scripts, configuration, or
  package metadata cannot alter a clean private result;
- the public command completes deterministically in under one minute.

Concrete task source, mutation recipe, public tests, and private tests are not
implemented in this bootstrap. They are the next two task-building issues.
