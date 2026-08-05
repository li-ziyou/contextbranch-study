import numpy as np

from rgb_composer import make_rgb


def test_composer_uses_one_range_for_all_channels_and_encodes_full_eight_bit_range():
    channel = np.array([[0.0, 5.0, 10.0]])
    image = make_rgb(channel, channel, channel, ranges=(0.0, 10.0), output_dtype=np.uint8)
    assert image.dtype == np.uint8
    assert image.shape == (1, 3, 3)
    assert tuple(image[0, 0]) == (0, 0, 0)
    assert tuple(image[0, 1]) == (128, 128, 128)
    assert tuple(image[0, 2]) == (255, 255, 255)
