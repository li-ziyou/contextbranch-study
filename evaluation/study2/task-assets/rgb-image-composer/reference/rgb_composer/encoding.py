"""Combine normalized image channels into a requested RGB representation."""

from collections.abc import Sequence

import numpy as np


def encode_rgb(channels: Sequence[np.ndarray], output_dtype: type | np.dtype = np.float64) -> np.ndarray:
    """Stack three normalized channels and encode float or 8-bit RGB output."""
    if len(channels) != 3:
        raise ValueError("exactly three channels are required")
    arrays = tuple(np.asarray(channel, dtype=float) for channel in channels)
    if len({channel.shape for channel in arrays}) != 1:
        raise ValueError("channel shapes must match")
    image = np.stack(arrays, axis=-1)
    dtype = np.dtype(output_dtype)
    if np.issubdtype(dtype, np.floating):
        return image.astype(dtype)
    if dtype == np.dtype(np.uint8):
        return np.rint(np.clip(image, 0.0, 1.0) * 255).astype(np.uint8)
    raise ValueError("output_dtype must be a floating-point type or numpy.uint8")
