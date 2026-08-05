# RGB Image Composer

This task is built from `astropy/astropy` at
`b0db0daac6b851596851cb43e5456fb6c916c071`. The frozen contract is
[`../../manifests/rgb-image-composer.json`](../../manifests/rgb-image-composer.json).

The builder creates a small workspace with the feature mutation, readable
public tests, and the fixed Study runtime. The participant works only in the
workspace created for their period. The expected production surface is the
allowlisted `astropy/visualization/` modules in the task manifest.

The task's reference patch and private behavioural checks remain outside the
participant bundle. They are used only by the clean-patch grader after the
session.
