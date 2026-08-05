"""Validate and normalize three grayscale image channels."""

from collections.abc import Sequence

import numpy as np


def normalize_channels(
    channels: Sequence[np.ndarray], ranges: tuple[float, float] | Sequence[tuple[float, float]] | None = None
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Validate three same-shaped channels and normalize each into ``[0, 1]``."""
    raise NotImplementedError("Implement channel normalization and validation.")
