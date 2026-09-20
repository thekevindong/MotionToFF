"""Checks for Gemini turn JSON → TTS spoken line."""

from interviewer import _parse_turn_json


def test_parse_turn_json_clean():
    raw = '{"spoken": "Thanks for your time today.", "end_session": true}'
    spoken, end = _parse_turn_json(raw)
    assert end is True
    assert spoken == "Thanks for your time today."


def test_parse_turn_json_with_prefix_noise():
    raw = 'Sure.\n{"spoken": "We are done for today.", "end_session": true}'
    spoken, end = _parse_turn_json(raw)
    assert end is True
    assert "done for today" in spoken


def test_parse_turn_json_does_not_speak_braces():
    raw = '{"spoken": "", "end_session": true}'
    spoken, end = _parse_turn_json(raw)
    assert end is True
    assert "{" not in spoken
    assert spoken
