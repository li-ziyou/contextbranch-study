"""Combine normalized image channels into a requested RGB representation."""

from collections.abc import Sequence

import numpy as np


def encode_rgb(channels: Sequence[np.ndarray], output_dtype: type | np.dtype = np.float64) -> np.ndarray:
    """Stack three normalized channels and encode float or 8-bit RGB output."""
    raise NotImplementedError("Implement RGB stacking and output encoding.")
