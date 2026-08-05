# RGB Image Composer

This curated task is derived from the Astropy RGB-composition feature at
`b0db0daac6b851596851cb43e5456fb6c916c071`. Its frozen contract is
[`../../manifests/rgb-image-composer.json`](../../manifests/rgb-image-composer.json).

The participant package contains a small `rgb_composer` package. The supplied
`composer.py` façade connects two initially incomplete modules:

- `normalization.py` validates and normalizes three grayscale channels.
- `encoding.py` stacks normalized channels and emits float or 8-bit RGB.

The modules do not overlap. Integrating both contributions into main produces
the requested end-to-end image compositor. The reference implementation and
private checks remain outside the participant bundle.
