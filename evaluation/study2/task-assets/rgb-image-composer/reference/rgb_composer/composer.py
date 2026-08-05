"""Stable composition layer for the RGB image-composer study task."""

from collections.abc import Sequence

import numpy as np

from .encoding import encode_rgb
from .normalization import normalize_channels


def make_rgb(
    red: np.ndarray,
    green: np.ndarray,
    blue: np.ndarray,
    ranges: tuple[float, float] | Sequence[tuple[float, float]] | None = None,
    output_dtype: type | np.dtype = np.float64,
) -> np.ndarray:
    """Normalize three grayscale channels and return one RGB image."""
    channels = normalize_channels((red, green, blue), ranges=ranges)
    return encode_rgb(channels, output_dtype=output_dtype)
