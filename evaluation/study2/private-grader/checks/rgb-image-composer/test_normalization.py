import numpy as np

from astropy.visualization import basic_rgb
from astropy.visualization.interval import ManualInterval


def test_normalizes_each_channel_with_its_own_interval():
    red = np.array([[0.0, 20.0]])
    green = np.array([[10.0, 30.0]])
    blue = np.array([[100.0, 200.0]])
    rgb = basic_rgb.make_rgb(
        red,
        green,
        blue,
        interval=[
            ManualInterval(vmin=0, vmax=20),
            ManualInterval(vmin=10, vmax=30),
            ManualInterval(vmin=100, vmax=200),
        ],
        output_dtype=np.float64,
    )
    np.testing.assert_allclose(rgb[0, 0], [0.0, 0.0, 0.0])
    np.testing.assert_allclose(rgb[0, 1], [1.0, 1.0, 1.0])


def test_float_output_is_clipped_and_uses_requested_float_type():
    channel = np.array([[-5.0, 5.0, 20.0]])
    rgb = basic_rgb.make_rgb(
        channel, channel, channel, interval=ManualInterval(vmin=0, vmax=10), output_dtype=float
    )
    assert np.issubdtype(rgb.dtype, np.floating)
    np.testing.assert_allclose(rgb[0, :, 0], [0.0, 0.5, 1.0])
