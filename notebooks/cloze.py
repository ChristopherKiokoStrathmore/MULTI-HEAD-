"""Fill-mask cloze scoring for an encoder MLM.

Davlan/afro-xlmr-large is XLM-RoBERTa adapted with masked language modeling
(Alabi et al. 2022). It is not a causal decoder, so this is not chat-style
generation. A head is scored only when every class surface form is a single
non-unk vocab token and those tokens do not collide. Otherwise the notebook
reports the piece breakdown and does not emit a cloze metric.
"""

from __future__ import annotations

from notebooks.metrics import ISSUE_LABELS, SENTIMENT_LABELS, URGENCY_LABELS, normalize_label

CANONICAL = {
    "issue": ISSUE_LABELS,
    "sentiment": SENTIMENT_LABELS,
    "urgency": URGENCY_LABELS,
}


class ClozeError(ValueError):
    pass


def labels_for_head(rows: list[dict], head: str) -> list[str]:
    seen = set()
    ordered = []
    for label in list(CANONICAL[head]) + [row[head] for row in rows]:
        key = normalize_label(label)
        if key in seen:
            continue
        seen.add(key)
        ordered.append(key)
    return ordered


def cloze_readiness(tokenizer, labels: list[str], verbalizers: dict | None = None) -> dict:
    verbalizers = verbalizers or {}
    mapping = {}
    used: dict[int, str] = {}
    problems = []
    for label in labels:
        key = normalize_label(label)
        surface = verbalizers.get(label) or verbalizers.get(key) or key.replace("_", " ")
        surface = str(surface).strip()
        ids = tokenizer.encode(surface, add_special_tokens=False)
        tokens = tokenizer.convert_ids_to_tokens(ids)
        token_id = None
        if len(ids) == 1 and ids[0] != tokenizer.unk_token_id:
            token_id = ids[0]
        mapping[key] = {"surface": surface, "ids": list(ids), "tokens": list(tokens), "token_id": token_id}
        if token_id is None:
            problems.append(f"{key!r} encodes as {tokens} ({len(ids)} pieces), not one vocab token")
        elif token_id in used:
            problems.append(f"{key!r} collides with {used[token_id]!r} on token id {token_id}")
        else:
            used[token_id] = key
    if len(mapping) < 2:
        problems.append("need at least two labels")
    ready = not problems
    return {"ready": ready, "reason": "ok" if ready else "; ".join(problems), "mapping": mapping}


def clip_text_to_template(tokenizer, text: str, template: str, max_length: int) -> str:
    """Shorten `text` so the filled template fits and still contains one mask."""
    mask_id = tokenizer.mask_token_id
    if mask_id is None:
        raise ClozeError("tokenizer has no mask_token_id")
    if "{text}" not in template:
        raise ClozeError("template must contain {text}")

    def fits(candidate: str) -> bool:
        prompt = template.replace("{text}", candidate)
        ids = tokenizer.encode(prompt, add_special_tokens=True)
        return len(ids) <= max_length and ids.count(mask_id) == 1

    if fits(text):
        return text
    lo, hi = 0, len(text)
    best = ""
    while lo <= hi:
        mid = (lo + hi) // 2
        candidate = text[:mid].rstrip()
        if fits(candidate):
            best = candidate
            lo = mid + 1
        else:
            hi = mid - 1
    if not best and not fits(""):
        raise ClozeError(
            "template does not fit in max_length with a single mask. Raise cloze_max_length."
        )
    return best


def load_masked_lm(model_name: str, device: str):
    import torch
    from transformers import AutoModelForMaskedLM, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(model_name)
    try:
        model = AutoModelForMaskedLM.from_pretrained(model_name)
    except (OSError, ValueError) as err:
        raise ClozeError(
            f"{model_name} did not load as a masked LM ({err}). "
            "AfroXLMR-large is encoder-only. Cloze scoring needs the MLM head; "
            "without it, use the frozen encoder probe."
        ) from err
    model.eval()
    for param in model.parameters():
        param.requires_grad_(False)
    model.to(device)
    return model, tokenizer, torch


def predict_cloze(model, tokenizer, texts, mapping: dict, template: str, device: str, batch_size: int, max_length: int) -> list[str]:
    import torch

    mask_token = tokenizer.mask_token
    if not mask_token or mask_token not in template:
        raise ClozeError(f"template must contain the tokenizer mask token {mask_token!r}")
    if not mapping or any(info.get("token_id") is None for info in mapping.values()):
        raise ClozeError("predict_cloze requires a ready single-token mapping")
    id_to_label = {info["token_id"]: label for label, info in mapping.items()}
    label_ids = list(id_to_label)
    preds = []
    model.eval()
    for start in range(0, len(texts), batch_size):
        batch = texts[start : start + batch_size]
        prompts = []
        for text in batch:
            clipped = clip_text_to_template(tokenizer, text, template, max_length)
            prompts.append(template.replace("{text}", clipped))
        encoded = tokenizer(
            prompts,
            return_tensors="pt",
            padding=True,
            truncation=False,
        )
        mask_id = tokenizer.mask_token_id
        counts = (encoded["input_ids"] == mask_id).sum(dim=1)
        if not torch.equal(counts, torch.ones_like(counts)):
            raise ClozeError("each cloze prompt must contain exactly one mask token")
        encoded = {key: value.to(device) for key, value in encoded.items()}
        with torch.no_grad():
            logits = model(**encoded).logits
        positions = (encoded["input_ids"] == mask_id).nonzero(as_tuple=False)
        for row_i in range(len(batch)):
            pos = int(positions[row_i, 1])
            chosen = int(logits[row_i, pos, label_ids].argmax().item())
            preds.append(id_to_label[label_ids[chosen]])
    return preds
