import numpy as np
import pytest

from astropy.visualization import basic_rgb
from astropy.visualization.interval import ManualInterval


def test_returns_a_normalized_float_rgb_image():
    red = np.array([[0.0, 10.0], [5.0, 2.5]])
    green = np.array([[10.0, 0.0], [5.0, 7.5]])
    blue = np.array([[5.0, 10.0], [0.0, 2.5]])
    image = basic_rgb.make_rgb(
        red, green, blue, interval=ManualInterval(vmin=0, vmax=10), output_dtype=np.float64
    )
    assert image.shape == (2, 2, 3)
    assert image.dtype == np.float64
    assert np.all((0.0 <= image) & (image <= 1.0))


def test_returns_uint8_when_requested():
    channel = np.array([[0.0, 10.0]])
    image = basic_rgb.make_rgb(
        channel, channel, channel, interval=ManualInterval(vmin=0, vmax=10), output_dtype=np.uint8
    )
    assert image.dtype == np.uint8
    assert image[0, 0, 0] == 0
    assert image[0, 1, 2] == 255


def test_rejects_channels_with_different_shapes():
    with pytest.raises(ValueError, match="shapes must match"):
        basic_rgb.make_rgb(np.zeros((2, 2)), np.zeros((2, 3)), np.zeros((2, 2)))
