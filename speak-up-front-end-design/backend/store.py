"""In-process session store (later: Tiger Data / hypertable)."""

from typing import Any

_records: list[dict[str, Any]] = []


def save(record: dict[str, Any]) -> None:
    _records.append(record)


def load() -> list[dict[str, Any]]:
    return list(_records)


def clear() -> None:
    """Reset store — useful for tests and /debug."""
    _records.clear()
