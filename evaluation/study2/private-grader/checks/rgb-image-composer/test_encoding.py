import numpy as np
import pytest

from rgb_composer.output import RGBEncoder


def test_encoder_preserves_requested_float_precision_and_clips_values():
    result = RGBEncoder(np.float32).encode(
        (np.array([[-1.0, 0.25, 2.0]]),) * 3
    )
    assert result.dtype == np.float32
    np.testing.assert_allclose(result[0, :, 0], [0.0, 0.25, 1.0])


@pytest.mark.parametrize(
    "encoder,channels",
    [
        (RGBEncoder(np.int16), (np.zeros((1, 1)),) * 3),
        (RGBEncoder(), (np.zeros((1, 1)), np.zeros((1, 1)))),
        (RGBEncoder(), (np.zeros((1, 1)), np.zeros((1, 2)), np.zeros((1, 1)))),
    ],
)
def test_encoder_rejects_unsupported_outputs_and_mismatched_channels(encoder: RGBEncoder, channels: tuple[np.ndarray, ...]):
    with pytest.raises(ValueError):
        encoder.encode(channels)
