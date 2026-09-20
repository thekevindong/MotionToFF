"""Idempotent seed for the public speaking speech catalog (Phase 1)."""

from __future__ import annotations

import re
import sqlite3
from datetime import datetime, timezone
from typing import Any

from repository import DB_PATH, _connect, init_db

HIGHSPARK_SOURCE = "https://highspark.co/blogs/famous-persuasive-speeches"

SPEECH_SEEDS: list[dict[str, Any]] = [
    {
        "id": "speech-mlk-dream",
        "slug": "mlk-dream",
        "speaker": "Martin Luther King Jr.",
        "title": "I Have a Dream (excerpt)",
        "sort_order": 1,
        "excerpt_text": (
            "I say to you today, my friends, so even though we face the difficulties of today "
            "and tomorrow, I still have a dream. It is a dream deeply rooted in the American dream.\n\n"
            "I have a dream that one day this nation will rise up and live out the true meaning of "
            "its creed: We hold these truths to be self-evident, that all men are created equal.\n\n"
            "I have a dream that one day on the red hills of Georgia, the sons of former slaves and "
            "the sons of former slave owners will be able to sit down together at the table of "
            "brotherhood.\n\n"
            "I have a dream that my four little children will one day live in a nation where they "
            "will not be judged by the color of their skin but by the content of their character.\n\n"
            "I have a dream today.\n\n"
            "And when this happens, and when we allow freedom to ring, when we let it ring from every "
            "village and every hamlet, from every state and every city, we will be able to speed up "
            "that day when all of God's children, black men and white men, Jews and Gentiles, "
            "Protestants and Catholics, will be able to join hands and sing in the words of the old "
            "Negro spiritual: Free at last! Free at last! Thank God Almighty, we are free at last!"
        ),
    },
    {
        "id": "speech-elizabeth-tilbury",
        "slug": "elizabeth-tilbury",
        "speaker": "Queen Elizabeth I",
        "title": "Speech to the Troops at Tilbury (excerpt)",
        "sort_order": 2,
        "excerpt_text": (
            "My loving people, we have been persuaded by some that are careful of our safety to take "
            "heed how we commit ourselves to armed multitudes for fear of treachery; but I assure you, "
            "I do not desire to live to distrust my faithful and loving people.\n\n"
            "Let tyrants fear. I have always so behaved myself that, under God, I have placed my "
            "chiefest strength and safeguard in the loyal hearts and good-will of my subjects; and "
            "therefore I am come amongst you, as you see, at this time, not for my recreation and "
            "disport, but being resolved, in the midst and heat of the battle, to live and die amongst "
            "you all; to lay down for my God, and for my kingdom, and my people, my honour and my "
            "blood, even in the dust.\n\n"
            "I know I have the body of a weak and feeble woman; but I have the heart and stomach of a "
            "king, and of a king of England too, and think foul scorn that Parma or Spain, or any prince "
            "of Europe, should dare to invade the borders of my realm; to which rather than any "
            "dishonour shall grow by me, I myself will take up arms, I myself will be your general, "
            "judge, and rewarder of every one of your virtues in the field.\n\n"
            "I know already, for your forwardness you have deserved rewards and crowns; and we do "
            "assure you, on the word of a prince, they cannot be counted too heavy or too honourable. "
            "By your obedience to my general, by your concord in the camp, and your valour in the "
            "field, we shall shortly have a famous victory over those enemies of my God, of my kingdom, "
            "and of my people."
        ),
    },
    {
        "id": "speech-sojourner-truth",
        "slug": "sojourner-truth",
        "speaker": "Sojourner Truth",
        "title": "Ain't I a Woman? (excerpt)",
        "sort_order": 3,
        "excerpt_text": (
            "Well, children, where there is so much racket there must be something out of kilter. "
            "I think that 'twixt the negroes of the South and the women at the North, all talking "
            "about rights, the white men will be in a fix pretty soon.\n\n"
            "That man over there says that women need to be helped into carriages, and lifted over "
            "ditches, and to have the best place everywhere. Nobody ever helps me into carriages, "
            "or over mud-puddles, or gives me any best place! And ain't I a woman? Look at me! "
            "Look at my arm! I have ploughed and planted, and gathered into barns, and no man could "
            "head me! And ain't I a woman? I could work as much and eat as much as a man—when I "
            "could get it—and bear the lash as well! And ain't I a woman?\n\n"
            "I have borne thirteen children, and seen most all sold off to slavery, and when I cried "
            "out with my mother's grief, none but Jesus heard me! And ain't I a woman?\n\n"
            "Then they talk about this thing in the head; what's this they call it? If the first woman "
            "God ever made was strong enough to turn the world upside down all alone, these women "
            "together ought to be able to turn it back, and get it right side up again! And now they "
            "is asking to do it, the men better let them.\n\n"
            "Obliged to you for hearing me, and now old Sojourner ain't got nothing more to say."
        ),
    },
]


def _word_count(text: str) -> int:
    return len(re.findall(r"\b[\w']+\b", text))


def _est_full_duration_sec(word_count: int) -> int:
    """~2.5 words per second at a steady podium pace."""
    return max(1, round(word_count / 2.5))


def seed_speeches(conn: sqlite3.Connection | None = None) -> int:
    """INSERT OR REPLACE all catalog speeches by slug. Returns rows written."""
    now = datetime.now(timezone.utc).isoformat()
    rows_written = 0

    def _run(c: sqlite3.Connection) -> None:
        nonlocal rows_written
        for item in SPEECH_SEEDS:
            excerpt = item["excerpt_text"].strip()
            wc = _word_count(excerpt)
            est = _est_full_duration_sec(wc)
            c.execute(
                """
                INSERT INTO speeches (
                    id, slug, speaker, title, excerpt_text, source_url,
                    word_count, est_full_duration_sec, sort_order, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(slug) DO UPDATE SET
                    speaker = excluded.speaker,
                    title = excluded.title,
                    excerpt_text = excluded.excerpt_text,
                    source_url = excluded.source_url,
                    word_count = excluded.word_count,
                    est_full_duration_sec = excluded.est_full_duration_sec,
                    sort_order = excluded.sort_order
                """,
                (
                    item["id"],
                    item["slug"],
                    item["speaker"],
                    item["title"],
                    excerpt,
                    HIGHSPARK_SOURCE,
                    wc,
                    est,
                    item["sort_order"],
                    now,
                ),
            )
            rows_written += 1

    if conn is not None:
        _run(conn)
    else:
        with _connect() as c:
            _run(c)
    return rows_written


def main() -> None:
    init_db()
    count = seed_speeches()
    print(f"Seeded {count} speeches into {DB_PATH}")


if __name__ == "__main__":
    main()
