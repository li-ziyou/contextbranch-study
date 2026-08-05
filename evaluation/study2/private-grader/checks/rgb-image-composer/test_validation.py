import numpy as np
import pytest

from astropy.visualization import basic_rgb
from astropy.visualization.interval import ManualInterval


def test_rejects_mismatched_channel_shapes():
    with pytest.raises(ValueError, match="shapes must match"):
        basic_rgb.make_rgb(np.zeros((1, 2)), np.zeros((2, 1)), np.zeros((1, 2)))


def test_rejects_wrong_number_of_intervals_and_invalid_output_dtype():
    channel = np.zeros((1, 1))
    interval = ManualInterval(vmin=0, vmax=1)
    with pytest.raises(ValueError, match="1 or 3 instances for interval"):
        basic_rgb.make_rgb(channel, channel, channel, interval=[interval, interval])
    with pytest.raises(ValueError, match="output_dtype"):
        basic_rgb.make_rgb(channel, channel, channel, output_dtype=np.int64)
