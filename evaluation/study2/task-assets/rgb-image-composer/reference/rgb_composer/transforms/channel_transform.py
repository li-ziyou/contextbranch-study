"""Validate display intervals and transform three grayscale image channels."""

from collections.abc import Sequence

import numpy as np


class ChannelTransform:
    """Apply validated intervals and a display stretch to aligned channels."""

    def __init__(
        self,
        ranges: tuple[float, float] | Sequence[tuple[float, float]] | None = None,
        stretch: str = "linear",
    ) -> None:
        self.ranges = ranges
        self.stretch = stretch

    @staticmethod
    def _arrays(channels: Sequence[np.ndarray]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        if len(channels) != 3:
            raise ValueError("exactly three channels are required")
        arrays = tuple(np.asarray(channel, dtype=float) for channel in channels)
        if any(array.ndim != 2 for array in arrays):
            raise ValueError("channels must be two-dimensional grayscale arrays")
        if len({array.shape for array in arrays}) != 1:
            raise ValueError("channel shapes must match")
        if any(not np.isfinite(array).all() for array in arrays):
            raise ValueError("channels must contain only finite values")
        return arrays  # type: ignore[return-value]

    def _ranges(self, arrays: Sequence[np.ndarray]) -> list[tuple[float, float]]:
        if self.ranges is None:
            return [(float(array.min()), float(array.max())) for array in arrays]
        if len(self.ranges) == 2 and not isinstance(self.ranges[0], (tuple, list, np.ndarray)):
            shared = tuple(float(value) for value in self.ranges)
            return [shared] * 3  # type: ignore[list-item]
        if len(self.ranges) != 3:
            raise ValueError("ranges must contain one pair or three pairs")
        resolved = [tuple(float(value) for value in pair) for pair in self.ranges]
        if any(len(pair) != 2 for pair in resolved):
            raise ValueError("each range must contain lower and upper values")
        return resolved

    def apply(self, channels: Sequence[np.ndarray]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Validate and transform exactly three same-shaped grayscale channels."""
        if self.stretch not in {"linear", "sqrt"}:
            raise ValueError("stretch must be 'linear' or 'sqrt'")
        arrays = self._arrays(channels)
        transformed: list[np.ndarray] = []
        for array, (lower, upper) in zip(arrays, self._ranges(arrays), strict=True):
            if upper < lower:
                raise ValueError("each range must satisfy lower <= upper")
            if upper == lower:
                normalized = np.zeros(array.shape, dtype=float)
            else:
                normalized = np.clip((array - lower) / (upper - lower), 0.0, 1.0)
            transformed.append(np.sqrt(normalized) if self.stretch == "sqrt" else normalized)
        return tuple(transformed)  # type: ignore[return-value]
