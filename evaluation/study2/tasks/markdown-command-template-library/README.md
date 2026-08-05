# Markdown Command Template Library

This curated task is derived from the MLflow command-template feature at
`93dab383a1a3fc9882ebc32283ad2a05d79ff70f`. Its frozen contract is
[`../../manifests/markdown-command-template-library.json`](../../manifests/markdown-command-template-library.json).

The participant package contains a small `template_library` package. The
provided `library.py` façade composes two initially incomplete modules:

- `frontmatter.py` parses optional metadata and returns the Markdown body.
- `catalog.py` finds Markdown files and retrieves a selected template.

The modules do not overlap. After both contributions are integrated into main,
the supplied façade exposes listing, filtering, complete retrieval, and
body-only retrieval. The task's reference implementation and private checks
remain outside the participant bundle.
