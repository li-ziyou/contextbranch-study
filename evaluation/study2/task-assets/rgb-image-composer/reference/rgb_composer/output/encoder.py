"""Encode transformed channels into one displayable RGB array."""

from collections.abc import Sequence

import numpy as np


class RGBEncoder:
    """Stack three normalized channels as float or 8-bit RGB output."""

    def __init__(self, output_dtype: type | np.dtype = np.uint8) -> None:
        self.output_dtype = output_dtype

    def encode(self, channels: Sequence[np.ndarray]) -> np.ndarray:
        """Validate normalized channels and emit an ``H x W x 3`` RGB image."""
        if len(channels) != 3:
            raise ValueError("exactly three channels are required")
        arrays = tuple(np.asarray(channel, dtype=float) for channel in channels)
        if any(array.ndim != 2 for array in arrays):
            raise ValueError("channels must be two-dimensional grayscale arrays")
        if len({array.shape for array in arrays}) != 1:
            raise ValueError("channel shapes must match")
        image = np.stack(tuple(np.clip(array, 0.0, 1.0) for array in arrays), axis=-1)
        dtype = np.dtype(self.output_dtype)
        if np.issubdtype(dtype, np.floating):
            return image.astype(dtype)
        if dtype == np.dtype(np.uint8):
            return np.rint(image * 255).astype(np.uint8)
        raise ValueError("output_dtype must be a floating-point type or numpy.uint8")
