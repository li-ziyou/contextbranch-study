"""Minimal transform classes used by interval and stretch implementations."""

__all__ = ["BaseTransform", "CompositeTransform"]


class BaseTransform:
    def __add__(self, other):
        return CompositeTransform(other, self)


class CompositeTransform(BaseTransform):
    def __init__(self, transform_1, transform_2):
        self.transform_1 = transform_1
        self.transform_2 = transform_2

    def __call__(self, values, clip=True):
        return self.transform_2(self.transform_1(values, clip=clip), clip=clip)

    @property
    def inverse(self):
        return self.__class__(self.transform_2.inverse, self.transform_1.inverse)
