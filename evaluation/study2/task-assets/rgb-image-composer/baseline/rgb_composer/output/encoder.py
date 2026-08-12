"""Encode transformed channels into one displayable RGB array."""

from collections.abc import Sequence

import numpy as np


class RGBEncoder:
    """Stack three normalized channels as float or 8-bit RGB output."""

    def __init__(self, output_dtype: type | np.dtype = np.uint8) -> None:
        self.output_dtype = output_dtype

    def encode(self, channels: Sequence[np.ndarray]) -> np.ndarray:
        """Validate normalized channels and emit an ``H x W x 3`` RGB image."""
        raise NotImplementedError("Implement RGB validation, stacking, and output encoding.")
