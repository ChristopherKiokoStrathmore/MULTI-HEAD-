"""Metric definitions shared with eval/run.mjs and eval/urgency-ops.mjs.

Names and formulas follow the Node harness on purpose. Issue and sentiment
"macro-F1" is the unweighted mean of per-class F1 over gold labels with
support. Classes that appear only as false positives are left out of that
mean. Urgency kappa is quadratic-weighted Cohen's kappa on
{low, medium, emergency}. Labels outside that set are skipped, not coerced.
"""

from __future__ import annotations

import re

URGENCY_ORDER = ("low", "medium", "emergency")

ISSUE_LABELS = (
    "Airtel_Money_Reversal",
    "Airtel_Money_Transfer",
    "App_Rewards",
    "Complaint_General",
    "Data_Bundle_Problems",
    "Network_Issues",
    "Non_Actionable",
    "Product_Enquiry",
    "Router_WiFi_5G",
    "SIM_Line_Services",
)
SENTIMENT_LABELS = ("negative", "not_negative")
URGENCY_LABELS = URGENCY_ORDER

HEADS = ("issue", "sentiment", "urgency")


def normalize_label(raw) -> str:
    text = "" if raw is None else str(raw)
    return re.sub(r"[\s-]+", "_", text.strip().lower())


def _empty_counts() -> dict:
    return {"tp": 0, "fp": 0, "fn": 0, "support": 0}


def score_head(gold_labels, pred_labels) -> dict:
    """Port of scoreHead in eval/run.mjs."""
    n = min(len(gold_labels), len(pred_labels))
    gold_n = [normalize_label(gold_labels[i]) for i in range(n)]
    pred_n = [normalize_label(pred_labels[i]) for i in range(n)]
    correct = sum(1 for g, p in zip(gold_n, pred_n) if g == p)

    classes = set(gold_n) | set(pred_n)
    per_class = {label: _empty_counts() for label in sorted(classes)}
    confusion: dict[str, dict[str, int]] = {}
    for g, p in zip(gold_n, pred_n):
        confusion.setdefault(g, {})
        confusion[g][p] = confusion[g].get(p, 0) + 1
        per_class[g]["support"] += 1
        if g == p:
            per_class[g]["tp"] += 1
        else:
            per_class[g]["fn"] += 1
            per_class[p]["fp"] += 1

    class_rows = []
    for label in sorted(per_class):
        counts = per_class[label]
        precision = 0.0 if counts["tp"] + counts["fp"] == 0 else counts["tp"] / (counts["tp"] + counts["fp"])
        recall = 0.0 if counts["tp"] + counts["fn"] == 0 else counts["tp"] / (counts["tp"] + counts["fn"])
        f1 = 0.0 if precision + recall == 0 else (2 * precision * recall) / (precision + recall)
        class_rows.append({"label": label, **counts, "precision": precision, "recall": recall, "f1": f1})

    gold_classes = [row for row in class_rows if row["support"] > 0]
    macro_f1 = 0.0 if not gold_classes else sum(row["f1"] for row in gold_classes) / len(gold_classes)

    off_diag = []
    for gold, row in confusion.items():
        for pred, count in row.items():
            if gold != pred:
                off_diag.append({"gold": gold, "pred": pred, "count": count})
    off_diag.sort(key=lambda item: item["count"], reverse=True)

    return {
        "n": n,
        "correct": correct,
        "accuracy": 0.0 if n == 0 else correct / n,
        "macroF1": macro_f1,
        "perClass": class_rows,
        "confusionPairs": off_diag,
    }


def class_f1(report: dict, label: str):
    key = normalize_label(label)
    for row in report["perClass"]:
        if row["label"] == key and row["support"] > 0:
            return row["f1"]
    return None


def quadratic_weighted_kappa(gold_labels, pred_labels, order=URGENCY_ORDER):
    """Port of quadraticWeightedKappa in eval/urgency-ops.mjs."""
    index = {label: i for i, label in enumerate(order)}
    k = len(order)
    if k < 2:
        return None
    matrix = [[0 for _ in range(k)] for _ in range(k)]
    n = 0
    limit = min(len(gold_labels), len(pred_labels))
    for i in range(limit):
        gi = index.get(normalize_label(gold_labels[i]))
        pi = index.get(normalize_label(pred_labels[i]))
        if gi is None or pi is None:
            continue
        matrix[gi][pi] += 1
        n += 1
    if n == 0:
        return None

    row_marg = [sum(row) for row in matrix]
    col_marg = [0 for _ in range(k)]
    for i in range(k):
        for j in range(k):
            col_marg[j] += matrix[i][j]

    denom = (k - 1) * (k - 1)
    po = 0.0
    pe = 0.0
    for i in range(k):
        for j in range(k):
            weight = 1 - ((i - j) * (i - j)) / denom
            po += weight * (matrix[i][j] / n)
            pe += weight * ((row_marg[i] * col_marg[j]) / (n * n))
    if abs(1 - pe) < 1e-12:
        return 1 if po >= 1 - 1e-12 else 0
    return (po - pe) / (1 - pe)


def score_urgency_ops(gold_labels, pred_labels) -> dict:
    """Port of scoreUrgencyOps in eval/urgency-ops.mjs."""
    n = min(len(gold_labels), len(pred_labels))
    emergency_support = 0
    emergency_hits = 0
    non_emergency_support = 0
    false_emergency_count = 0
    for i in range(n):
        gold = normalize_label(gold_labels[i])
        pred = normalize_label(pred_labels[i])
        pred_emergency = pred == "emergency"
        if gold == "emergency":
            emergency_support += 1
            if pred_emergency:
                emergency_hits += 1
        else:
            non_emergency_support += 1
            if pred_emergency:
                false_emergency_count += 1
    emergency_recall = None if emergency_support == 0 else emergency_hits / emergency_support
    false_emergency_rate = None if non_emergency_support == 0 else false_emergency_count / non_emergency_support
    kappa = quadratic_weighted_kappa(gold_labels, pred_labels)
    return {
        "n": n,
        "emergencySupport": emergency_support,
        "emergencyHits": emergency_hits,
        "emergencyMisses": emergency_support - emergency_hits,
        "emergencyRecall": emergency_recall,
        "nonEmergencySupport": non_emergency_support,
        "falseEmergencyCount": false_emergency_count,
        "falseEmergencyRate": false_emergency_rate,
        "quadraticWeightedKappa": kappa,
        "kappaMethod": "quadratic-weighted Cohen's kappa on ordinal {low, medium, emergency}",
    }


def triage_metrics(gold_rows, predictions) -> dict:
    """Score three heads. `predictions` align 1:1 with `gold_rows`."""
    if len(gold_rows) != len(predictions):
        raise ValueError(
            f"gold rows ({len(gold_rows)}) and predictions ({len(predictions)}) differ in length"
        )
    issue_gold = [row["issue"] for row in gold_rows]
    sent_gold = [row["sentiment"] for row in gold_rows]
    urg_gold = [row["urgency"] for row in gold_rows]
    issue_pred = [row["issue"] for row in predictions]
    sent_pred = [row["sentiment"] for row in predictions]
    urg_pred = [row["urgency"] for row in predictions]
    issue = score_head(issue_gold, issue_pred)
    sentiment = score_head(sent_gold, sent_pred)
    urgency = score_head(urg_gold, urg_pred)
    ops = score_urgency_ops(urg_gold, urg_pred)
    return {
        "n": len(gold_rows),
        "issue_macro_f1": issue["macroF1"],
        "sentiment_macro_f1": sentiment["macroF1"],
        "sentiment_f1_negative": class_f1(sentiment, "negative"),
        "sentiment_f1_not_negative": class_f1(sentiment, "not_negative"),
        "urgency_macro_f1": urgency["macroF1"],
        "urgency_quadratic_kappa": ops["quadraticWeightedKappa"],
        "emergency_recall": ops["emergencyRecall"],
        "false_emergency_rate": ops["falseEmergencyRate"],
        "issue": issue,
        "sentiment": sentiment,
        "urgency": urgency,
        "urgency_ops": ops,
    }


_ROW_KEYS = (
    "n",
    "issue_macro_f1",
    "sentiment_macro_f1",
    "sentiment_f1_negative",
    "urgency_quadratic_kappa",
    "emergency_recall",
    "false_emergency_rate",
    "urgency_macro_f1",
)


def partial_triage(gold_rows, issue_pred=None, sentiment_pred=None, urgency_pred=None) -> dict:
    """Score whichever heads were actually predicted. Missing heads stay None.

    A missing head is not filled with a dummy label, so it cannot show up as a zero.
    """
    n = len(gold_rows)
    result = {"n": n, **{key: None for key in _ROW_KEYS if key != "n"}}

    def require(pred, name):
        if pred is not None and len(pred) != n:
            raise ValueError(f"{name} predictions ({len(pred)}) and gold rows ({n}) differ in length")

    require(issue_pred, "issue")
    require(sentiment_pred, "sentiment")
    require(urgency_pred, "urgency")
    if issue_pred is not None:
        result["issue_macro_f1"] = score_head([row["issue"] for row in gold_rows], issue_pred)["macroF1"]
    if sentiment_pred is not None:
        sentiment = score_head([row["sentiment"] for row in gold_rows], sentiment_pred)
        result["sentiment_macro_f1"] = sentiment["macroF1"]
        result["sentiment_f1_negative"] = class_f1(sentiment, "negative")
    if urgency_pred is not None:
        urgency_gold = [row["urgency"] for row in gold_rows]
        ops = score_urgency_ops(urgency_gold, urgency_pred)
        result["urgency_quadratic_kappa"] = ops["quadraticWeightedKappa"]
        result["emergency_recall"] = ops["emergencyRecall"]
        result["false_emergency_rate"] = ops["falseEmergencyRate"]
        result["urgency_macro_f1"] = score_head(urgency_gold, urgency_pred)["macroF1"]
    return result


def metric_row(system: str, note: str, triage: dict | None) -> dict:
    row = {"system": system, "note": note, **{key: None for key in _ROW_KEYS}}
    if triage is None:
        return row
    for key in _ROW_KEYS:
        if key in triage:
            row[key] = triage[key]
    return row


def fmt_metric(value, digits: int = 3) -> str:
    if value is None:
        return "n/a"
    return f"{float(value):.{digits}f}"


def format_comparison(records: list[dict]) -> str:
    """Plain-text table. Sentiment F1 in the harness sense is macro-F1."""
    headers = [
        ("system", "system"),
        ("n", "n"),
        ("issue_macro_f1", "issue macro-F1"),
        ("sentiment_macro_f1", "sentiment macro-F1"),
        ("sentiment_f1_negative", "sentiment F1 (negative)"),
        ("urgency_quadratic_kappa", "urgency kappa"),
        ("emergency_recall", "emergency recall"),
        ("false_emergency_rate", "false-emergency"),
        ("urgency_macro_f1", "urgency macro-F1"),
    ]
    body = []
    for record in records:
        cells = []
        for key, _title in headers:
            value = record.get(key)
            if key in ("system", "n"):
                cells.append("n/a" if value is None else str(value))
            else:
                cells.append(fmt_metric(value))
        body.append(cells)
    widths = []
    for col, (_key, title) in enumerate(headers):
        width = len(title)
        for row in body:
            width = max(width, len(row[col]))
        widths.append(width)

    def render(cells):
        return "  ".join(cell.ljust(widths[i]) for i, cell in enumerate(cells))

    lines = [render([title for _key, title in headers]), render(["-" * width for width in widths])]
    lines.extend(render(row) for row in body)
    lines.append("")
    lines.append("notes")
    for record in records:
        lines.append(f"  {record['system']}: {record.get('note') or ''}")
    lines.append(
        "sentiment macro-F1 matches eval/run.mjs (unweighted mean of per-class F1 over gold labels with support). "
        "sentiment F1 (negative) is the F1 of the negative class only."
    )
    return "\n".join(lines)
