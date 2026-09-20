"""Phase 8 QA matrix — speaking judge heuristics."""

from speaking import mock_teleprompter, presage_speaking_judge


def _sample_speech() -> dict:
    return {
        "speaker": "Test Speaker",
        "title": "Test Speech",
        "excerpt_text": "one two three four five six seven eight nine ten " * 40,
        "est_full_duration_sec": 120,
    }


def test_mock_teleprompter_without_gemini_key():
    result = mock_teleprompter(_sample_speech(), "30")
    assert result["lines"]
    assert result.get("source") == "mock"
    assert int(result.get("target_sec") or 0) == 30


def test_timed_teleprompter_ends_on_full_sentences():
    speech = {
        "speaker": "Test",
        "title": "Test",
        "excerpt_text": (
            "We hold these truths to be self-evident. "
            "That all men are created equal. "
            "That they are endowed by their Creator with certain unalienable Rights. "
            "That among these are Life, Liberty and the pursuit of Happiness."
        ),
        "est_full_duration_sec": 180,
    }
    for mode in ("30", "45"):
        result = mock_teleprompter(speech, mode)
        joined = " ".join(result["lines"]).strip()
        assert joined
        assert joined[-1] in ".!?"
        for line in result["lines"]:
            assert line.strip()[-1] in ".!?"


def test_empty_delivery_on_timer_silence():
    raw = presage_speaking_judge(
        transcript="",
        teleprompter_lines=["Line one", "Line two"],
        duration_mode="30",
        finished_in_time=False,
        target_duration_sec=30,
        elapsed_sec=30,
        delivery_summary={},
        composure_turn=0.5,
        ended_by="timer",
    )
    assert "empty_delivery" in raw["red_flags"]
    assert raw["timing"]["finished_in_time"] is False
    assert "No spoken transcript" in raw["timing"]["notes"]


def test_early_user_finish_in_time_with_note():
    raw = presage_speaking_judge(
        transcript="We hold these truths to be self evident that all people are created equal.",
        teleprompter_lines=["We hold these truths", "to be self evident"],
        duration_mode="30",
        finished_in_time=True,
        target_duration_sec=30,
        elapsed_sec=18,
        delivery_summary={"avg_composure": 0.7},
        composure_turn=0.7,
        ended_by="user",
    )
    assert "empty_delivery" not in raw["red_flags"]
    assert raw["timing"]["finished_in_time"] is True
    assert "before the countdown" in raw["timing"]["notes"]


def test_early_exit_not_finished_in_time():
    raw = presage_speaking_judge(
        transcript="Short attempt.",
        teleprompter_lines=["Line one", "Line two"],
        duration_mode="45",
        finished_in_time=False,
        target_duration_sec=45,
        elapsed_sec=10,
        delivery_summary={},
        composure_turn=0.5,
        ended_by="early_exit",
    )
    assert "missed_time_budget" in raw["red_flags"]
    assert "ended early" in raw["timing"]["notes"].lower()


def test_presage_degraded_evidence():
    raw = presage_speaking_judge(
        transcript="A full sentence for the audience.",
        teleprompter_lines=["A full sentence"],
        duration_mode="full",
        finished_in_time=True,
        target_duration_sec=0,
        elapsed_sec=40,
        delivery_summary={"presage_degraded": True},
        composure_turn=0.6,
        ended_by="user",
    )
    assert any("degraded" in e.lower() for e in raw["evidence"])
