# Markdown Command Template Library

This task is built from `mlflow/mlflow` at
`93dab383a1a3fc9882ebc32283ad2a05d79ff70f`. The frozen contract is
[`../../manifests/markdown-command-template-library.json`](../../manifests/markdown-command-template-library.json).

The builder creates a small workspace with the feature mutation, readable
public tests, and the fixed Study runtime. The participant works only in the
workspace created for their period. The expected production surface is
`mlflow/ai_commands/ai_command_utils.py` and, when needed,
`mlflow/ai_commands/__init__.py`.

The task's reference patch and private behavioural checks remain outside the
participant bundle. They are used only by the clean-patch grader after the
session.
