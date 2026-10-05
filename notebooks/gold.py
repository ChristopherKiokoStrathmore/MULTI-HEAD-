"""Labeled-file loader for the notebooks.

Column names match eval/run.mjs: text, issue, sentiment, urgency, optional id.
Lines whose first non-whitespace character is # are comments. This repo does
not contain a production gold split. The synthetic smoke CSV is opt-in.
"""

from __future__ import annotations

import csv
import io
import math
from pathlib import Path

from notebooks.metrics import HEADS, normalize_label

SMOKE_BASENAME = "synthetic-heldout.smoke.csv"
SMOKE_BANNER = (
    "SYNTHETIC SMOKE — eval/synthetic-heldout.smoke.csv is not production gold, "
    "not a held-out set, and not a model-quality result. See eval/README.md."
)


class GoldLoadError(ValueError):
    pass


def _cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    text = str(value).strip()
    if text.lower() == "nan":
        return ""
    return text


def _norm_header(header) -> str:
    return _cell(header).lower()


def _rows_from_records(records: list[dict]) -> tuple[list[dict], list[dict]]:
    rows = []
    skipped = []
    for i, rec in enumerate(records):
        text = _cell(rec.get("text"))
        issue = _cell(rec.get("issue"))
        sentiment = _cell(rec.get("sentiment"))
        urgency = _cell(rec.get("urgency"))
        row_id = _cell(rec.get("id")) or str(i + 1)
        if not text or not issue or not sentiment or not urgency:
            skipped.append(
                {"row": i + 2, "id": row_id, "reason": "missing text/issue/sentiment/urgency"}
            )
            continue
        rows.append(
            {"id": row_id, "text": text, "issue": issue, "sentiment": sentiment, "urgency": urgency}
        )
    return rows, skipped


def _require_columns(fields: list[str], path: Path) -> None:
    missing = [name for name in ("text", "issue", "sentiment", "urgency") if name not in fields]
    if not missing:
        return
    hint = ""
    if "text" in missing and "message" in fields:
        hint = " Found `message` instead of `text`. eval/run.mjs requires `text`; rename the column."
    raise GoldLoadError(
        f"{path} is missing required column(s): {', '.join(missing)}. "
        f"Headers seen: {fields or '(none)'}.{hint}"
    )


def _strip_comment_lines(raw: str) -> str:
    kept = []
    for line in raw.splitlines():
        if line.lstrip().startswith("#"):
            continue
        kept.append(line)
    return "\n".join(kept) + ("\n" if kept else "")


def load_csv(path: Path) -> dict:
    raw = path.read_text(encoding="utf-8-sig")
    reader = csv.DictReader(io.StringIO(_strip_comment_lines(raw)))
    if not reader.fieldnames:
        raise GoldLoadError(f"{path} has no header row. Need text, issue, sentiment, urgency.")
    fields = [_norm_header(name) for name in reader.fieldnames]
    _require_columns(fields, path)
    records = []
    for rec in reader:
        lowered = {}
        for key, value in rec.items():
            if key is None:
                continue
            lowered[_norm_header(key)] = value
        records.append(lowered)
    rows, skipped = _rows_from_records(records)
    if not rows:
        raise GoldLoadError(f"No usable labeled rows in {path}. Need text, issue, sentiment, urgency.")
    return {"rows": rows, "skipped": skipped, "path": str(path), "smoke": path.name == SMOKE_BASENAME}


def load_xlsx(path: Path, sheet=0) -> dict:
    try:
        import pandas as pd
    except ImportError as err:
        raise GoldLoadError(
            "Reading xlsx needs pandas and openpyxl (`pip install pandas openpyxl`). "
            "Or export a CSV with the eval/run.mjs columns and set gold_csv."
        ) from err
    try:
        frame = pd.read_excel(path, sheet_name=sheet, dtype=object)
    except ImportError as err:
        raise GoldLoadError(
            "Reading xlsx needs openpyxl (`pip install openpyxl`)."
        ) from err
    fields = [_norm_header(name) for name in frame.columns]
    _require_columns(fields, path)
    records = []
    for rec in frame.to_dict(orient="records"):
        records.append({_norm_header(key): value for key, value in rec.items()})
    rows, skipped = _rows_from_records(records)
    if not rows:
        raise GoldLoadError(f"No usable labeled rows in {path} sheet {sheet!r}.")
    return {"rows": rows, "skipped": skipped, "path": str(path), "smoke": False}


def load_labeled_file(path, sheet=0) -> dict:
    path = Path(path)
    if not path.is_file():
        raise GoldLoadError(f"Labeled file not found: {path}")
    if path.suffix.lower() in {".xlsx", ".xls"}:
        return load_xlsx(path, sheet=sheet)
    return load_csv(path)


def inside_repo(path, root: Path) -> bool:
    try:
        Path(path).resolve().relative_to(Path(root).resolve())
    except ValueError:
        return False
    return True


def _repo_warning(path, root: Path, smoke: bool) -> str:
    if smoke or not inside_repo(path, root):
        return ""
    return (
        f"{path} is inside the git repo. Do not commit it if it contains customer messages."
    )


def resolve_labeled(config: dict, root: Path, role: str) -> dict:
    """Resolve gold or few-shot paths from CONFIG.

    `role` is `gold` or `fewshot`. Gold may fall back to the smoke fixture
    only when allow_smoke_fixture is true. Few-shot never falls back.
    """
    if role not in {"gold", "fewshot"}:
        raise ValueError("role must be gold or fewshot")
    csv_key = f"{role}_csv"
    xlsx_key = f"{role}_xlsx"
    csv_path = str(config.get(csv_key) or "").strip()
    xlsx_path = str(config.get(xlsx_key) or "").strip()
    if csv_path and xlsx_path:
        raise GoldLoadError(f"Set {csv_key} or {xlsx_key}, not both.")
    sheet = config.get("xlsx_sheet", 0)
    if csv_path or xlsx_path:
        chosen = Path(csv_path or xlsx_path)
        if not chosen.is_absolute():
            chosen = root / chosen
        loaded = load_labeled_file(chosen, sheet=sheet)
        loaded["warning"] = _repo_warning(loaded["path"], root, loaded["smoke"])
        loaded["role"] = role
        return loaded
    if role == "gold" and config.get("allow_smoke_fixture"):
        smoke = root / "eval" / SMOKE_BASENAME
        loaded = load_labeled_file(smoke)
        loaded["warning"] = SMOKE_BANNER
        loaded["role"] = role
        return loaded
    if role == "gold":
        reason = (
            "No gold file set. Set CONFIG['gold_csv'] or CONFIG['gold_xlsx'] to a local export "
            "with columns text, issue, sentiment, urgency. "
            "The file the live harness scores is whatever you pass to "
            "`node eval/run.mjs --csv`. It is not in git. "
            "Modal health reports the checkpoint at /data/ckpt/joint_big_model.pt; "
            "this repo does not record a gold path on that volume. "
            "Set allow_smoke_fixture true only for a wiring check."
        )
    else:
        reason = (
            "No few-shot file set. Set CONFIG['fewshot_csv'] or CONFIG['fewshot_xlsx'] "
            "to rows that do not overlap the gold ids or texts, or set "
            "split_n_shot_from_gold true to hold out N per issue class from gold "
            "and score every system on the remainder."
        )
    return {"rows": None, "skipped": [], "path": "", "smoke": False, "warning": "", "role": role, "reason": reason}


def find_leakage(train_rows, test_rows) -> list[str]:
    problems = []
    train_ids = {row["id"] for row in train_rows}
    overlap_ids = sorted(train_ids & {row["id"] for row in test_rows})
    if overlap_ids:
        problems.append(f"shared ids (showing up to 8): {overlap_ids[:8]}")

    def norm_text(text: str) -> str:
        return " ".join(str(text).split())

    train_texts = {norm_text(row["text"]) for row in train_rows}
    text_hits = [row["id"] for row in test_rows if norm_text(row["text"]) in train_texts]
    if text_hits:
        problems.append(f"exact text overlap on scored ids (showing up to 8): {text_hits[:8]}")
    return problems


def support_counts(rows) -> dict:
    counts = {head: {} for head in HEADS}
    for row in rows:
        for head in HEADS:
            label = normalize_label(row[head])
            counts[head][label] = counts[head].get(label, 0) + 1
    return counts
