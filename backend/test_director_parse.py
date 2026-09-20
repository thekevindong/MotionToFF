"""Quick checks for director keyword parsing."""

from director import DEFAULT_ACTION, parse_director_action


def test_first_token():
    assert parse_director_action("press_harder") == "press_harder"
    assert parse_director_action("  curveball\n") == "curveball"


def test_keyword_scan():
    assert parse_director_action("Here's a thinking process:\nuse ease_off") == "ease_off"


def test_default():
    assert parse_director_action("") == DEFAULT_ACTION
    assert parse_director_action("definitely keep going") == DEFAULT_ACTION
