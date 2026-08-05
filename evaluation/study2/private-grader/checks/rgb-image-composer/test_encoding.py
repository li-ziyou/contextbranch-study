import numpy as np

from astropy.visualization import basic_rgb
from astropy.visualization.interval import ManualInterval
from astropy.visualization.stretch import LogStretch


def test_encodes_uint8_channels_with_the_full_eight_bit_range():
    channel = np.array([[0.0, 5.0, 10.0]])
    rgb = basic_rgb.make_rgb(
        channel, channel, channel, interval=ManualInterval(vmin=0, vmax=10), output_dtype=np.uint8
    )
    assert rgb.dtype == np.uint8
    assert rgb.shape == (1, 3, 3)
    assert tuple(rgb[0, 0]) == (0, 0, 0)
    assert tuple(rgb[0, -1]) == (255, 255, 255)


def test_accepts_a_non_linear_stretch_for_all_three_channels():
    channel = np.array([[0.0, 5.0, 10.0]])
    rgb = basic_rgb.make_rgb(
        channel,
        channel,
        channel,
        interval=ManualInterval(vmin=0, vmax=10),
        stretch=LogStretch(a=100),
        output_dtype=np.float64,
    )
    assert 0.5 < rgb[0, 1, 1] < 1.0
