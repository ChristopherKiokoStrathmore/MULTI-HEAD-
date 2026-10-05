"""Emoji vs <unk> audit for the AfroXLMR tokenizer.

The production policy is to keep emoji. This repo's API client posts the
message it was given; it does not strip emoji. The audit measures whether
Davlan/afro-xlmr-large's tokenizer keeps those characters as pieces.
"""

from __future__ import annotations

from collections import Counter

# Joiners that belong to emoji sequences (ZWJ, variation selectors, keycap).
_JOINERS = {0x200D, 0xFE0E, 0xFE0F, 0x20E3}


def is_emoji_char(ch: str) -> bool:
    if len(ch) != 1:
        return False
    code = ord(ch)
    return (
        0x1F000 <= code <= 0x1FAFF
        or 0x1F1E6 <= code <= 0x1F1FF
        or 0x2600 <= code <= 0x27BF
        or 0x2300 <= code <= 0x23FF
        or 0x2B00 <= code <= 0x2BFF
        or code in (0x00A9, 0x00AE, 0x203C, 0x2049, 0x2122, 0x2139, 0x3030, 0x303D, 0x3297, 0x3299)
    )


def strip_emoji(text: str) -> str:
    """Remove emoji characters and their joiners. Leave other text unchanged."""
    if not any(is_emoji_char(ch) for ch in text):
        return text
    kept = []
    for ch in text:
        code = ord(ch)
        if is_emoji_char(ch) or code in _JOINERS:
            continue
        kept.append(ch)
    collapsed = []
    previous_space = False
    for ch in kept:
        if ch == " ":
            if previous_space:
                continue
            previous_space = True
        else:
            previous_space = False
        collapsed.append(ch)
    return "".join(collapsed).strip()


def _token_ids(tokenizer, text: str) -> list[int]:
    encoded = tokenizer(text, add_special_tokens=True)
    ids = encoded["input_ids"]
    if hasattr(ids, "tolist"):
        ids = ids.tolist()
    if ids and isinstance(ids[0], list):
        ids = ids[0]
    return list(ids)


def audit_text(tokenizer, text: str) -> dict:
    stripped = strip_emoji(text)
    emoji_chars = [ch for ch in text if is_emoji_char(ch)]
    with_ids = _token_ids(tokenizer, text)
    without_ids = _token_ids(tokenizer, stripped)
    with_tokens = list(tokenizer.convert_ids_to_tokens(with_ids))
    without_tokens = list(tokenizer.convert_ids_to_tokens(without_ids))
    unk_id = tokenizer.unk_token_id
    unk_with = sum(1 for token_id in with_ids if token_id == unk_id)
    unk_without = sum(1 for token_id in without_ids if token_id == unk_id)
    extra_unk = unk_with - unk_without
    emoji_in_token = any(any(ch in token for ch in emoji_chars) for token in with_tokens)
    if not emoji_chars:
        status = "no_emoji"
    elif emoji_in_token and extra_unk <= 0:
        status = "real_tokens"
    elif emoji_in_token and extra_unk > 0:
        status = "mixed"
    elif extra_unk > 0:
        status = "unk"
    elif with_tokens == without_tokens:
        status = "unchanged"
    else:
        status = "mixed"
    return {
        "text": text,
        "stripped": stripped,
        "emoji": "".join(emoji_chars),
        "status": status,
        "tokens": with_tokens,
        "tokens_without_emoji": without_tokens,
        "unk_with_emoji": unk_with,
        "unk_without_emoji": unk_without,
        "extra_unk": extra_unk,
        "emoji_visible_in_tokens": emoji_in_token,
    }


def summarize_audits(audits: list[dict]) -> dict:
    counts = Counter(item["status"] for item in audits)
    emoji_audits = [item for item in audits if item["status"] != "no_emoji"]
    statuses = {item["status"] for item in emoji_audits}
    if not emoji_audits:
        aggregate = "no_emoji"
    elif statuses <= {"unk", "unchanged"}:
        aggregate = "unk"
    elif statuses == {"real_tokens"}:
        aggregate = "real_tokens"
    else:
        aggregate = "mixed"
    return {"counts": dict(counts), "aggregate": aggregate, "n": len(audits)}


def production_policy(summary: dict) -> str:
    aggregate = summary.get("aggregate", "unmeasured")
    keep = (
        "Production policy: keep emoji in the stored message and in the text sent to the classifier. "
        "Do not strip them in preprocessing."
    )
    detail = {
        "no_emoji": "This sample had no emoji, so the tokenizer question is unanswered.",
        "unk": (
            "On this sample the tokenizer maps emoji to <unk> or drops them, so AfroXLMR does not "
            "keep a distinct emoji piece. Keep them anyway. lib/api.ts posts the message it was given "
            "and does not strip emoji. Human review still needs the original characters, and stripping "
            "would be a new preprocess this service does not do."
        ),
        "real_tokens": (
            "On this sample emoji survive as tokenizer pieces. Stripping them would delete signal "
            "the encoder can see."
        ),
        "mixed": (
            "On this sample some emoji are real pieces and some are <unk> or dropped. "
            "Keep the original string either way."
        ),
        "unmeasured": "The tokenizer was not loaded, so this audit has not been measured yet.",
    }.get(aggregate, "See the per-message status column.")
    return f"{keep} {detail}"
