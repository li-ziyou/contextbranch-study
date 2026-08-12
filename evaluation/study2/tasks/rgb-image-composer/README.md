# Configurable RGB Image Composer

This curated task is derived from the Astropy RGB-composition feature at
`b0db0daac6b851596851cb43e5456fb6c916c071`. Its frozen contract is
[`../../manifests/rgb-image-composer.json`](../../manifests/rgb-image-composer.json).

The participant package contains a small `rgb_composer` package. The supplied
`RGBComposer` façade connects two initially incomplete packages:

- `transforms/channel_transform.py` defines interval validation and linear or
  square-root display transformation for three aligned channels.
- `output/encoder.py` defines validation, channel stacking, clipping, and
  floating-point or 8-bit RGB encoding.

The two responsibilities live in separate folders and communicate through a
normalized three-channel array contract. Integrating both contributions into
main produces a configurable end-to-end image compositor. The reference
implementation and private checks remain outside the participant bundle.
