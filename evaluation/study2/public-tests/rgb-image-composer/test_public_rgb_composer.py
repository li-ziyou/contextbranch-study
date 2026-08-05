import numpy as np
import pytest

from rgb_composer import make_rgb
from rgb_composer.encoding import encode_rgb
from rgb_composer.normalization import normalize_channels


def test_normalizes_each_channel_into_the_unit_interval():
    red = np.array([[0.0, 10.0]])
    green = np.array([[10.0, 20.0]])
    blue = np.array([[100.0, 200.0]])
    normalized = normalize_channels((red, green, blue))
    np.testing.assert_allclose(normalized[0], [[0.0, 1.0]])
    np.testing.assert_allclose(normalized[1], [[0.0, 1.0]])
    np.testing.assert_allclose(normalized[2], [[0.0, 1.0]])


def test_stacks_normalized_channels_as_uint8_rgb():
    image = encode_rgb(
        (np.array([[0.0, 1.0]]), np.array([[0.5, 0.5]]), np.array([[1.0, 0.0]])),
        output_dtype=np.uint8,
    )
    assert image.dtype == np.uint8
    assert image.shape == (1, 2, 3)
    assert tuple(image[0, 0]) == (0, 128, 255)


def test_composes_a_normalized_float_rgb_image_and_rejects_shape_mismatches():
    image = make_rgb(
        np.array([[0.0, 10.0]]),
        np.array([[10.0, 0.0]]),
        np.array([[5.0, 10.0]]),
        ranges=(0.0, 10.0),
    )
    assert image.dtype == np.float64
    assert image.shape == (1, 2, 3)
    np.testing.assert_allclose(image[0, 0], [0.0, 1.0, 0.5])
    with pytest.raises(ValueError, match="shapes must match"):
        make_rgb(np.zeros((1, 2)), np.zeros((2, 1)), np.zeros((1, 2)))
