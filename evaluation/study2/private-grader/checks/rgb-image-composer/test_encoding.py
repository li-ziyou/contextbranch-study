import numpy as np
import pytest

from rgb_composer.encoding import encode_rgb


def test_preserves_requested_float_precision_and_rejects_unsupported_dtypes():
    channel = np.array([[0.25]], dtype=np.float64)
    result = encode_rgb((channel, channel, channel), output_dtype=np.float32)
    assert result.dtype == np.float32
    np.testing.assert_allclose(result[0, 0], [0.25, 0.25, 0.25])
    with pytest.raises(ValueError, match="output_dtype"):
        encode_rgb((channel, channel, channel), output_dtype=np.int16)


def test_encoder_checks_channel_count_and_shape():
    with pytest.raises(ValueError, match="exactly three"):
        encode_rgb((np.zeros((1, 1)), np.zeros((1, 1))))
    with pytest.raises(ValueError, match="shapes must match"):
        encode_rgb((np.zeros((1, 1)), np.zeros((1, 2)), np.zeros((1, 1))))
