"""Baseline B: the deployed three-head checkpoint.

This repo does not define the MultiHead module or the CORN urgency head.
GET /health on the live service reports checkpoint `/data/ckpt/joint_big_model.pt`.
eval/run.mjs scores that deployment with POST /predict_batch. These helpers
do the same call. A local .pt path is reported and not unpickled.
"""

from __future__ import annotations

import json
import os
import socket
import urllib.error
import urllib.request
from pathlib import Path

MODAL_CHECKPOINT = "/data/ckpt/joint_big_model.pt"
DEFAULT_API_BASE = "https://thechriskioko--threehead-serve-server-fastapi-app.modal.run"
HEALTH_TIMEOUT_S = 120
BATCH_TIMEOUT_S = 180


class BaselineBError(RuntimeError):
    pass


def resolve_api_base(explicit: str = "") -> str:
    """Same order as eval/run.mjs: flag, MULTIHEAD_API_URL, NEXT_PUBLIC_API_URL, Modal host."""
    from_env = (os.environ.get("MULTIHEAD_API_URL") or os.environ.get("NEXT_PUBLIC_API_URL") or "").strip()
    raw = (explicit or from_env or DEFAULT_API_BASE).strip()
    return raw.rstrip("/")


def checkpoint_status(local_path: str = "") -> dict:
    candidates = []
    for raw in (local_path, os.environ.get("MULTIHEAD_CKPT", ""), MODAL_CHECKPOINT):
        text = str(raw or "").strip()
        if text and text not in candidates:
            candidates.append(text)
    found = []
    for raw in candidates:
        path = Path(raw)
        if path.is_file():
            found.append({"path": str(path), "bytes": path.stat().st_size})
    return {
        "modal_checkpoint_reported_by_health": MODAL_CHECKPOINT,
        "candidates": candidates,
        "files_present": found,
        "loaded": False,
        "reason": (
            "This repository does not contain the MultiHead class or the CORN urgency head. "
            "A local .pt file is reported, not unpickled. Baseline B is scored by "
            "POST /predict_batch, which is how eval/run.mjs uses the deployed "
            f"checkpoint ({MODAL_CHECKPOINT} on the Modal volume)."
        ),
    }


def _fetch_json(url: str, payload, timeout: int):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "Accept": "application/json"} if data else {"Accept": "application/json"},
        method="POST" if data is not None else "GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as err:
        snippet = err.read().decode("utf-8", errors="replace")[:400]
        raise BaselineBError(f"HTTP {err.code} from {url} — {snippet}") from err
    except (TimeoutError, socket.timeout) as err:
        raise BaselineBError(f"Timed out after {timeout}s waiting for {url}") from err
    except urllib.error.URLError as err:
        raise BaselineBError(f"Could not reach {url} — {err.reason}") from err
    try:
        return json.loads(body)
    except json.JSONDecodeError as err:
        raise BaselineBError(f"{url} did not return JSON: {body[:200]}") from err


def fetch_health(api_base: str) -> dict:
    health = _fetch_json(f"{api_base}/health", None, HEALTH_TIMEOUT_S)
    if not isinstance(health, dict):
        raise BaselineBError(f"{api_base}/health did not return a JSON object")
    return health


def predict_batch(api_base: str, texts: list[str], chunk_size: int = 20) -> list[dict]:
    """POST /predict_batch in chunks. Returns one prediction dict per text, in order.

    Message text is not included in errors beyond what the server itself returns,
    and it is not printed here.
    """
    if chunk_size < 1:
        raise BaselineBError("chunk_size must be >= 1")
    predictions = []
    for start in range(0, len(texts), chunk_size):
        chunk = texts[start : start + chunk_size]
        data = _fetch_json(
            f"{api_base}/predict_batch",
            {"texts": chunk},
            BATCH_TIMEOUT_S,
        )
        if not isinstance(data, list) or len(data) != len(chunk):
            got = len(data) if isinstance(data, list) else type(data).__name__
            raise BaselineBError(
                f"/predict_batch returned {got} item(s) for {len(chunk)} text(s). "
                "eval/run.mjs expects a JSON array aligned with the request."
            )
        for item in data:
            if not isinstance(item, dict):
                raise BaselineBError("/predict_batch item was not an object")
            for key in ("issue", "sentiment", "urgency"):
                if key not in item or item[key] is None or str(item[key]).strip() == "":
                    raise BaselineBError(f"/predict_batch item is missing {key}")
            predictions.append(
                {
                    "issue": item["issue"],
                    "sentiment": item["sentiment"],
                    "urgency": item["urgency"],
                }
            )
        done = min(start + chunk_size, len(texts))
        print(f"classified {done}/{len(texts)}")
    return predictions
