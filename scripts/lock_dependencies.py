"""Capture tested package versions from the active venv; no credentials or machine paths in outputs."""

from importlib.metadata import distributions
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEV = {"pytest", "pytest-cov", "coverage", "ruff", "pluggy", "iniconfig", "pygments"}
IGNORE = {"pip", "setuptools", "teachease-backend"}


def main():
    runtime, dev = [], []
    for distribution in distributions():
        name = distribution.metadata["Name"]
        normalized = name.lower().replace("_", "-")
        if normalized in IGNORE:
            continue
        (dev if normalized in DEV else runtime).append(f"{name}=={distribution.version}")
    (ROOT / "requirements.lock").write_text(
        "# Tested runtime versions; refresh deliberately in a clean virtual environment.\n"
        + "\n".join(sorted(runtime, key=str.lower))
        + "\n",
        encoding="utf-8",
    )
    (ROOT / "requirements-dev.lock").write_text(
        "-r requirements.lock\n" + "\n".join(sorted(dev, key=str.lower)) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
