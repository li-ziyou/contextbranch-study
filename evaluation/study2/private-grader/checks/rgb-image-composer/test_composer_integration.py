import numpy as np
import pytest

from rgb_composer import RGBComposer, make_rgb


def test_composer_applies_sqrt_stretch_before_full_eight_bit_encoding():
    channel = np.array([[0.0, 2.5, 10.0]])
    image = RGBComposer(ranges=(0.0, 10.0), stretch="sqrt", output_dtype=np.uint8).compose(
        channel, channel, channel
    )
    assert image.dtype == np.uint8
    assert image.shape == (1, 3, 3)
    assert tuple(image[0, 0]) == (0, 0, 0)
    assert tuple(image[0, 1]) == (128, 128, 128)
    assert tuple(image[0, 2]) == (255, 255, 255)


def test_convenience_function_preserves_the_same_composition_contract():
    image = make_rgb(
        np.array([[0.0, 10.0]]),
        np.array([[0.0, 10.0]]),
        np.array([[0.0, 10.0]]),
        output_dtype=np.float64,
    )
    assert image.dtype == np.float64
    with pytest.raises(ValueError, match="channel shapes must match"):
        make_rgb(np.zeros((1, 2)), np.zeros((2, 1)), np.zeros((1, 2)))
