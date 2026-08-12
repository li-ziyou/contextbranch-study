"""Stable façade that composes channel transformation and RGB encoding."""

from collections.abc import Sequence

import numpy as np

from .output import RGBEncoder
from .transforms import ChannelTransform


class RGBComposer:
    """Compose aligned grayscale channels using a configurable display pipeline."""

    def __init__(
        self,
        ranges: tuple[float, float] | Sequence[tuple[float, float]] | None = None,
        stretch: str = "linear",
        output_dtype: type | np.dtype = np.uint8,
    ) -> None:
        self._transform = ChannelTransform(ranges=ranges, stretch=stretch)
        self._encoder = RGBEncoder(output_dtype=output_dtype)

    def compose(self, red: np.ndarray, green: np.ndarray, blue: np.ndarray) -> np.ndarray:
        """Transform three input channels and encode one RGB image."""
        return self._encoder.encode(self._transform.apply((red, green, blue)))


def make_rgb(
    red: np.ndarray,
    green: np.ndarray,
    blue: np.ndarray,
    ranges: tuple[float, float] | Sequence[tuple[float, float]] | None = None,
    stretch: str = "linear",
    output_dtype: type | np.dtype = np.uint8,
) -> np.ndarray:
    """Convenience function for one configurable RGB composition."""
    return RGBComposer(ranges=ranges, stretch=stretch, output_dtype=output_dtype).compose(red, green, blue)
