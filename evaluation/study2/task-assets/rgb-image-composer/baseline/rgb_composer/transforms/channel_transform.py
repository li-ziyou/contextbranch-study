"""Validate display intervals and transform three grayscale image channels."""

from collections.abc import Sequence

import numpy as np


class ChannelTransform:
    """Apply validated intervals and a display stretch to aligned channels.

    ``ranges`` may be absent, one ``(lower, upper)`` pair shared by all
    channels, or three pairs. ``stretch`` is either ``"linear"`` or
    ``"sqrt"``. The resulting arrays are floating point values in ``[0, 1]``.
    """

    def __init__(
        self,
        ranges: tuple[float, float] | Sequence[tuple[float, float]] | None = None,
        stretch: str = "linear",
    ) -> None:
        self.ranges = ranges
        self.stretch = stretch

    def apply(self, channels: Sequence[np.ndarray]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Validate and transform exactly three same-shaped grayscale channels."""
        raise NotImplementedError("Implement channel validation, intervals, and display stretch.")
