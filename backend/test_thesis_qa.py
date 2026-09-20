"""Thesis Defense — document validation, committee pick, mock questions."""

from thesis import (
    ALLOWED_THESIS_PACKS,
    COMMITTEE_CHARACTER_IDS,
    THESIS_PACKS,
    THESIS_PRESENTATION_QUESTION,
    ThesisValidationError,
    mock_thesis_questions,
    pick_committee_character,
    presage_thesis_judge,
    thesis_prepare,
    thesis_presentation_complete,
    thesis_qa_start,
    validate_thesis_documents,
)
from judge import pending_turn_scores
from repository import add_document, create_session, get_session_settings, get_turns, init_db


def _defense_text() -> str:
    return (
        "We propose a lightweight method for composure-aware interview practice. "
        "Our approach combines browser face metrics with server-side scoring. "
        "Limitations include demo-scale evaluation and single-session persistence."
    )


def test_thesis_pack_constants():
    assert ALLOWED_THESIS_PACKS == frozenset({"short", "long"})
    assert THESIS_PACKS["short"]["presentation_duration_sec"] == 30
    assert THESIS_PACKS["long"]["qa_duration_sec"] == 120


def test_validate_thesis_documents_requires_single_txt():
    init_db()
    session_id = create_session(settings={"scenario_id": "thesis"})
    try:
        validate_thesis_documents(session_id)
        assert False, "expected thesis_requires_txt"
    except ThesisValidationError as exc:
        assert exc.code == "thesis_requires_txt"

    add_document(
        session_id,
        filename="defense.txt",
        mime="text/plain",
        content=_defense_text().encode("utf-8"),
        extracted_text=_defense_text(),
    )
    meta = validate_thesis_documents(session_id)
    assert meta["filename"] == "defense.txt"
    assert meta["text_len"] >= 80


def test_validate_rejects_pdf_only_document():
    init_db()
    session_id = create_session(settings={"scenario_id": "thesis"})
    add_document(
        session_id,
        filename="defense.pdf",
        mime="application/pdf",
        content=b"%PDF-1.4",
        extracted_text=_defense_text(),
    )
    try:
        validate_thesis_documents(session_id)
        assert False, "expected thesis_requires_txt"
    except ThesisValidationError as exc:
        assert exc.code == "thesis_requires_txt"


def test_validate_rejects_empty_txt_extract():
    init_db()
    session_id = create_session(settings={"scenario_id": "thesis"})
    add_document(
        session_id,
        filename="empty.txt",
        mime="text/plain",
        content=b"short",
        extracted_text="too short",
    )
    try:
        validate_thesis_documents(session_id)
        assert False, "expected thesis_defense_text_empty"
    except ThesisValidationError as exc:
        assert exc.code == "thesis_defense_text_empty"


def test_pick_committee_character_is_stable():
    init_db()
    session_id = create_session(settings={"scenario_id": "thesis"})
    first = pick_committee_character(session_id)
    second = pick_committee_character(session_id)
    assert first == second
    assert first in COMMITTEE_CHARACTER_IDS


def _seed_defense_session() -> str:
    session_id = create_session(settings={"scenario_id": "thesis"})
    text = _defense_text()
    add_document(
        session_id,
        filename="defense.txt",
        mime="text/plain",
        content=text.encode("utf-8"),
        extracted_text=text,
    )
    return session_id


def test_thesis_prepare_persists_pack_and_defense_meta():
    init_db()
    session_id = _seed_defense_session()
    payload = thesis_prepare(session_id, "short")
    assert payload["thesis_pack"] == "short"
    assert payload["presentation_duration_sec"] == 30
    assert payload["qa_duration_sec"] == 60
    assert payload["defense_filename"] == "defense.txt"
    assert payload["character_id"] in COMMITTEE_CHARACTER_IDS

    settings = get_session_settings(session_id)
    assert settings["thesis_phase"] == "presentation"
    assert settings["defense_document_id"] == payload["defense_document_id"]


def test_thesis_prepare_character_sticky_on_second_prepare():
    init_db()
    session_id = _seed_defense_session()
    first = thesis_prepare(session_id, "short")
    second = thesis_prepare(session_id, "long")
    assert first["character_id"] == second["character_id"]
    assert second["thesis_pack"] == "long"
    assert second["presentation_duration_sec"] == 60


def test_thesis_presentation_complete_and_skip_qa():
    init_db()
    session_id = _seed_defense_session()
    thesis_prepare(session_id, "short")
    scores = pending_turn_scores(0.72)
    result = thesis_presentation_complete(
        session_id,
        transcript="We propose composure-aware practice with browser metrics.",
        elapsed_sec=22,
        finished_in_time=True,
        ended_by="user",
        samples=[],
        summary={"avg_composure": 0.72},
        composure_value=0.72,
        skip_qa=True,
        scores=scores,
    )
    assert result["end_session"] is True
    assert result["skip_qa"] is True

    turns = get_turns(session_id)
    assert len(turns) == 1
    assert turns[0]["question"] == THESIS_PRESENTATION_QUESTION
    assert turns[0]["decision"]["action"] == "thesis_presentation_complete"
    assert turns[0]["decision"]["skip_qa"] is True

    settings = get_session_settings(session_id)
    assert settings["skipped_qa"] is True
    assert settings["thesis_phase"] == "done"
    assert settings.get("presentation_stats")


def test_thesis_presentation_complete_idempotent():
    init_db()
    session_id = _seed_defense_session()
    thesis_prepare(session_id, "short")
    scores = pending_turn_scores(0.7)
    kwargs = {
        "transcript": "Summary of our method and limitations.",
        "elapsed_sec": 10,
        "finished_in_time": True,
        "ended_by": "user",
        "samples": [],
        "summary": {},
        "composure_value": 0.7,
        "skip_qa": False,
        "scores": scores,
    }
    first = thesis_presentation_complete(session_id, **kwargs)
    second = thesis_presentation_complete(session_id, **kwargs)
    assert first["skip_qa"] is False
    assert first["committee_character_id"]
    assert second == first
    assert len(get_turns(session_id)) == 1


def test_thesis_qa_start_after_presentation():
    init_db()
    session_id = create_session(settings={"scenario_id": "thesis"})
    text = _defense_text()
    add_document(
        session_id,
        filename="defense.txt",
        mime="text/plain",
        content=text.encode("utf-8"),
        extracted_text=text,
    )
    thesis_prepare(session_id, "short")
    thesis_presentation_complete(
        session_id,
        transcript="We propose composure-aware feedback for practice interviews.",
        elapsed_sec=20,
        finished_in_time=True,
        ended_by="user",
        samples=[],
        summary={},
        composure_value=0.7,
        skip_qa=False,
        scores={},
    )
    first = thesis_qa_start(session_id)
    assert first["question"]["text"].strip()
    assert first["end_session"] is False
    second = thesis_qa_start(session_id)
    assert second["question"]["text"] == first["question"]["text"]


def test_score_thesis_session_skip_qa_shape():
    init_db()
    session_id = _seed_defense_session()
    thesis_prepare(session_id, "short")
    scores = pending_turn_scores(0.72)
    thesis_presentation_complete(
        session_id,
        transcript="We propose composure-aware practice with validated methods and clear limitations.",
        elapsed_sec=22,
        finished_in_time=True,
        ended_by="user",
        samples=[],
        summary={"avg_composure": 0.72},
        composure_value=0.72,
        skip_qa=True,
        scores=scores,
    )
    from thesis import score_thesis_session

    report = score_thesis_session(session_id)
    assert report.get("thesis", {}).get("skipped_qa") is True
    assert report.get("thesis", {}).get("qa") is None
    assert isinstance(report.get("rubric"), dict)
    assert report["rubric"].get("overall") is not None
    assert report.get("source") in ("presage", "gemini")
    if report.get("source") == "presage":
        assert report.get("mock") is True


def test_presage_thesis_judge_empty_presentation_on_timer():
    raw = presage_thesis_judge(
        defense_text=_defense_text(),
        defense_filename="defense.txt",
        presentation_transcript="",
        presentation_summary={},
        presentation_composure=0.5,
        presentation_duration_sec=30,
        presentation_elapsed_sec=30,
        presentation_finished_in_time=False,
        presentation_ended_by="timer",
        qa_turns=[],
        skipped_qa=False,
        committee_character_id="hr",
    )
    assert "empty_presentation" in raw["red_flags"]
    assert raw["skipped_qa"] is False


def test_mock_thesis_questions_grounded_in_upload():
    init_db()
    session_id = create_session(settings={"scenario_id": "thesis"})
    text = _defense_text()
    add_document(
        session_id,
        filename="defense.txt",
        mime="text/plain",
        content=text.encode("utf-8"),
        extracted_text=text,
    )
    questions = mock_thesis_questions(session_id, 3)
    assert len(questions) == 3
    joined = " ".join(questions).lower()
    assert "composure" in joined or "limitation" in joined or "method" in joined
