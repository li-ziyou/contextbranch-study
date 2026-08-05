import numpy as np


def get_data_and_mask(values):
    """Return data plus a mask for normal and NumPy masked arrays."""
    if np.ma.isMaskedArray(values):
        return np.asanyarray(values.data), np.ma.getmaskarray(values)
    return np.asanyarray(values), None
