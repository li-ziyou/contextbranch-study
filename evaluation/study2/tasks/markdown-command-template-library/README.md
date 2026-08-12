# Scoped Markdown Command Library

This curated task is derived from the MLflow command-template feature at
`93dab383a1a3fc9882ebc32283ad2a05d79ff70f`. Its frozen contract is
[`../../manifests/markdown-command-template-library.json`](../../manifests/markdown-command-template-library.json).

The participant package contains a small `template_library` package. The
provided `TemplateLibrary` façade composes two initially incomplete packages:

- `metadata/frontmatter.py` defines validated template metadata and parses a
  Markdown header into a document contract.
- `catalog/index.py` recursively builds a canonical template index and safely
  resolves an indexed template.

The two responsibilities live in separate folders and interact through the
`ParsedTemplate` and `TemplateEntry` data contracts. After both contributions
are integrated into main, the supplied façade exposes metadata filtering,
complete retrieval, body-only retrieval, and placeholder rendering. The task's
reference implementation and private checks remain outside the participant
bundle.
