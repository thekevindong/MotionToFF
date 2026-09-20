"""Backward-compatible shim — persisted data lives in repository.py (SQLite)."""

from typing import Any

from repository import append_turn, clear_session, get_or_create_legacy_session, get_turns, init_db


def _default_session_id() -> str:
    init_db()
    return get_or_create_legacy_session()


def save(record: dict[str, Any]) -> None:
    append_turn(_default_session_id(), record)


def load() -> list[dict[str, Any]]:
    return get_turns(_default_session_id())


def clear() -> None:
    clear_session(_default_session_id())
