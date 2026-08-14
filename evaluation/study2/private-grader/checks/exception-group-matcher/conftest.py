import os

import pytest


@pytest.fixture(scope="session")
def form_id() -> str:
    return os.environ.get("CONTEXTBRANCH_STUDY_FORM_ID", "F1")


@pytest.fixture
def form_value(form_id: str):
    return lambda f1, f2: f2 if form_id == "F2" else f1
