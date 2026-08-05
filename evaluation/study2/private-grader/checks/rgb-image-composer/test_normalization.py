import numpy as np
import pytest

from rgb_composer.normalization import normalize_channels


def test_uses_a_different_supplied_range_for_each_channel_and_clips_values():
    normalized = normalize_channels(
        (np.array([[-1.0, 5.0, 20.0]]), np.array([[10.0, 20.0, 30.0]]), np.array([[2.0, 3.0, 4.0]])),
        ranges=[(0.0, 10.0), (10.0, 30.0), (2.0, 4.0)],
    )
    np.testing.assert_allclose(normalized[0], [[0.0, 0.5, 1.0]])
    np.testing.assert_allclose(normalized[1], [[0.0, 0.5, 1.0]])
    np.testing.assert_allclose(normalized[2], [[0.0, 0.5, 1.0]])


def test_constant_channels_and_invalid_ranges_are_handled_explicitly():
    zeros = normalize_channels((np.ones((1, 1)),) * 3)
    np.testing.assert_allclose(zeros[0], [[0.0]])
    with pytest.raises(ValueError, match="lower <= upper"):
        normalize_channels((np.zeros((1, 1)),) * 3, ranges=(2.0, 1.0))
