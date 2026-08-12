import numpy as np

from rgb_composer import RGBComposer
from rgb_composer.output import RGBEncoder
from rgb_composer.transforms import ChannelTransform


def test_transform_uses_per_channel_intervals_and_a_display_stretch():
    transformed = ChannelTransform(
        ranges=[(0.0, 4.0), (10.0, 14.0), (20.0, 24.0)], stretch="sqrt"
    ).apply(
        (
            np.array([[0.0, 1.0, 4.0]]),
            np.array([[10.0, 11.0, 14.0]]),
            np.array([[20.0, 21.0, 24.0]]),
        )
    )
    np.testing.assert_allclose(transformed[0], [[0.0, 0.5, 1.0]])
    np.testing.assert_allclose(transformed[1], [[0.0, 0.5, 1.0]])


def test_encoder_stacks_normalized_channels_as_requested_output_type():
    image = RGBEncoder(np.uint8).encode(
        (np.array([[0.0, 1.0]]), np.array([[0.5, 0.5]]), np.array([[1.0, 0.0]]))
    )
    assert image.dtype == np.uint8
    assert image.shape == (1, 2, 3)
    assert tuple(image[0, 0]) == (0, 128, 255)


def test_composer_integrates_both_responsibilities():
    image = RGBComposer(ranges=(0.0, 10.0), stretch="linear", output_dtype=np.float32).compose(
        np.array([[0.0, 10.0]]),
        np.array([[10.0, 0.0]]),
        np.array([[5.0, 10.0]]),
    )
    assert image.dtype == np.float32
    np.testing.assert_allclose(image[0, 0], [0.0, 1.0, 0.5])
