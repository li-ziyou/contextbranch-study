import numpy as np
import pytest

from rgb_composer.transforms import ChannelTransform


def test_transform_clips_to_intervals_and_handles_constant_channels():
    transformed = ChannelTransform(ranges=(0.0, 10.0)).apply(
        (np.array([[-2.0, 5.0, 20.0]]),) * 3
    )
    np.testing.assert_allclose(transformed[0], [[0.0, 0.5, 1.0]])
    zeros = ChannelTransform().apply((np.ones((1, 1)),) * 3)
    np.testing.assert_allclose(zeros[0], [[0.0]])


@pytest.mark.parametrize(
    "transform,channels",
    [
        (ChannelTransform(stretch="log"), (np.zeros((1, 1)),) * 3),
        (ChannelTransform(ranges=(2.0, 1.0)), (np.zeros((1, 1)),) * 3),
        (ChannelTransform(), (np.zeros((1, 2)), np.zeros((2, 1)), np.zeros((1, 2)))),
        (ChannelTransform(), (np.array([[np.nan]]),) * 3),
    ],
)
def test_transform_rejects_invalid_contracts(transform: ChannelTransform, channels: tuple[np.ndarray, ...]):
    with pytest.raises(ValueError):
        transform.apply(channels)
