"""Validate and normalize three grayscale image channels."""

from collections.abc import Sequence

import numpy as np


def _channel_ranges(
    channels: Sequence[np.ndarray], ranges: tuple[float, float] | Sequence[tuple[float, float]] | None
) -> list[tuple[float, float]]:
    if ranges is None:
        return [(float(channel.min()), float(channel.max())) for channel in channels]
    if len(ranges) == 2 and not isinstance(ranges[0], (tuple, list, np.ndarray)):
        return [tuple(float(value) for value in ranges)] * 3
    if len(ranges) != 3:
        raise ValueError("ranges must contain one pair or three pairs")
    return [tuple(float(value) for value in pair) for pair in ranges]


def normalize_channels(
    channels: Sequence[np.ndarray], ranges: tuple[float, float] | Sequence[tuple[float, float]] | None = None
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Validate three same-shaped channels and normalize each into ``[0, 1]``."""
    if len(channels) != 3:
        raise ValueError("exactly three channels are required")
    arrays = tuple(np.asarray(channel, dtype=float) for channel in channels)
    if any(channel.ndim != 2 for channel in arrays):
        raise ValueError("channels must be two-dimensional grayscale arrays")
    if len({channel.shape for channel in arrays}) != 1:
        raise ValueError("channel shapes must match")
    normalized: list[np.ndarray] = []
    for channel, (lower, upper) in zip(arrays, _channel_ranges(arrays, ranges), strict=True):
        if upper < lower:
            raise ValueError("each range must satisfy lower <= upper")
        if upper == lower:
            normalized.append(np.zeros(channel.shape, dtype=float))
        else:
            normalized.append(np.clip((channel - lower) / (upper - lower), 0.0, 1.0))
    return tuple(normalized)  # type: ignore[return-value]
