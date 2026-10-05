"""Frozen-encoder few-shot baselines.

Davlan/afro-xlmr-large stays frozen: eval mode, requires_grad false, and the
forward pass runs under torch.no_grad. The only fit is a nearest centroid or
a linear probe on detached mean-pooled embeddings. That is not multi-task
fine-tuning of a shared encoder, and it is not a CORN ordinal head.
"""

from __future__ import annotations

import random

import numpy as np

from notebooks.metrics import normalize_label


class ProbeError(ValueError):
    pass


def holdout_n_shot(rows: list[dict], n_per_issue: int, seed: int) -> tuple[list[dict], list[dict], list[str]]:
    """Stratify on normalized issue. Classes with n or fewer rows stay in the scored set.

    Taking every row of a class into the fit would leave that class with no
    held-out support, so those rows are not used to train.
    """
    if n_per_issue < 1:
        raise ProbeError("n_per_issue_class must be >= 1")
    grouped: dict[str, list[int]] = {}
    for index, row in enumerate(rows):
        grouped.setdefault(normalize_label(row["issue"]), []).append(index)
    rng = random.Random(seed)
    train_idx: list[int] = []
    test_idx: list[int] = []
    notes = []
    for issue, indexes in sorted(grouped.items()):
        order = indexes[:]
        rng.shuffle(order)
        if len(order) <= n_per_issue:
            test_idx.extend(order)
            notes.append(
                f"{issue}: {len(order)} row(s), which is not more than n={n_per_issue}; "
                "left in the scored set and not used to fit"
            )
            continue
        train_idx.extend(order[:n_per_issue])
        test_idx.extend(order[n_per_issue:])
    train_idx.sort()
    test_idx.sort()
    train_rows = [rows[i] for i in train_idx]
    test_rows = [rows[i] for i in test_idx]
    return train_rows, test_rows, notes


def l2_normalize(vectors: np.ndarray) -> np.ndarray:
    vectors = np.asarray(vectors, dtype=np.float64)
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms = np.clip(norms, 1e-8, None)
    return vectors / norms


def fit_nearest_centroid(embeddings: np.ndarray, labels: list[str]) -> dict:
    if len(embeddings) != len(labels):
        raise ProbeError("embeddings and labels differ in length")
    if len(labels) == 0:
        raise ProbeError("nearest centroid needs at least one N-shot row")
    y = np.array([normalize_label(label) for label in labels])
    x = l2_normalize(embeddings)
    classes = []
    means = []
    for label in sorted(set(y.tolist())):
        classes.append(label)
        means.append(x[y == label].mean(axis=0))
    means = l2_normalize(np.stack(means))
    return {"classes": np.array(classes), "means": means}


def predict_nearest_centroid(model: dict, embeddings: np.ndarray) -> list[str]:
    x = l2_normalize(embeddings)
    scores = x @ model["means"].T
    chosen = scores.argmax(axis=1)
    return [str(model["classes"][i]) for i in chosen]


class NumpyLinearProbe:
    """L2-regularized one-vs-rest logistic regression. Used when sklearn is absent."""

    def __init__(self, coef, intercept, classes, mu, sigma):
        self.coef = coef
        self.intercept = intercept
        self.classes_ = np.array(classes)
        self.mu = mu
        self.sigma = sigma

    def predict(self, embeddings: np.ndarray) -> list[str]:
        x = (np.asarray(embeddings, dtype=np.float64) - self.mu) / self.sigma
        scores = x @ self.coef.T + self.intercept
        chosen = scores.argmax(axis=1)
        return [str(self.classes_[i]) for i in chosen]


def _fit_numpy_logistic(x: np.ndarray, y: np.ndarray, l2: float = 1.0, steps: int = 400, lr: float = 0.2):
    classes = sorted(set(y.tolist()))
    if len(classes) == 1:
        mu = np.zeros(x.shape[1], dtype=np.float64)
        sigma = np.ones(x.shape[1], dtype=np.float64)
        coef = np.zeros((1, x.shape[1]), dtype=np.float64)
        intercept = np.zeros(1, dtype=np.float64)
        return NumpyLinearProbe(coef, intercept, classes, mu, sigma)
    mu = x.mean(axis=0)
    sigma = x.std(axis=0)
    sigma = np.where(sigma < 1e-6, 1.0, sigma)
    xs = (x - mu) / sigma
    coefs = []
    intercepts = []
    n = max(len(y), 1)
    for label in classes:
        target = (y == label).astype(np.float64)
        weight = np.zeros(xs.shape[1], dtype=np.float64)
        bias = 0.0
        for _ in range(steps):
            z = xs @ weight + bias
            prob = 1.0 / (1.0 + np.exp(-np.clip(z, -30, 30)))
            err = prob - target
            weight -= lr * ((xs.T @ err) / n + l2 * weight)
            bias -= lr * float(err.mean())
        coefs.append(weight)
        intercepts.append(bias)
    return NumpyLinearProbe(np.stack(coefs), np.array(intercepts), classes, mu, sigma)


class SklearnLinearProbe:
    def __init__(self, clf):
        self.clf = clf

    def predict(self, embeddings: np.ndarray) -> list[str]:
        return [str(label) for label in self.clf.predict(embeddings)]


def fit_linear_probe(embeddings: np.ndarray, labels: list[str]):
    """Fit a linear head on frozen embeddings. Does not touch encoder weights."""
    if len(embeddings) != len(labels):
        raise ProbeError("embeddings and labels differ in length")
    if len(labels) == 0:
        raise ProbeError("linear probe needs at least one N-shot row")
    y = np.array([normalize_label(label) for label in labels])
    x = np.asarray(embeddings, dtype=np.float64)
    try:
        from sklearn.linear_model import LogisticRegression
    except ImportError:
        return _fit_numpy_logistic(x, y)
    if len(set(y.tolist())) == 1:
        return _fit_numpy_logistic(x, y)
    clf = LogisticRegression(C=1.0, max_iter=500, solver="lbfgs")
    clf.fit(x, y)
    return SklearnLinearProbe(clf)


def resolve_device(choice: str) -> str:
    if choice != "auto":
        return choice
    import torch

    return "cuda" if torch.cuda.is_available() else "cpu"


def load_encoder(model_name: str, device: str):
    import torch
    from transformers import AutoModel, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModel.from_pretrained(model_name)
    model.eval()
    for param in model.parameters():
        param.requires_grad_(False)
    model.to(device)
    return model, tokenizer, torch


def embed_texts(model, tokenizer, texts: list[str], device: str, batch_size: int, max_length: int) -> np.ndarray:
    """Mean-pool the last hidden state with the attention mask. Encoder stays frozen."""
    import torch

    if batch_size < 1:
        raise ProbeError("embed_batch_size must be >= 1")
    vectors = []
    model.eval()
    for start in range(0, len(texts), batch_size):
        batch = texts[start : start + batch_size]
        encoded = tokenizer(
            batch,
            padding=True,
            truncation=True,
            max_length=max_length,
            return_tensors="pt",
        )
        encoded = {key: value.to(device) for key, value in encoded.items()}
        with torch.no_grad():
            hidden = model(**encoded).last_hidden_state
        mask = encoded["attention_mask"].unsqueeze(-1).type_as(hidden)
        pooled = (hidden * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1e-9)
        vectors.append(pooled.detach().cpu().numpy())
    if not vectors:
        hidden_size = int(getattr(model.config, "hidden_size", 0) or 0)
        return np.zeros((0, hidden_size), dtype=np.float64)
    return l2_normalize(np.concatenate(vectors, axis=0))


def predict_heads(train_rows, train_embeddings, test_embeddings, fitter) -> list[dict]:
    """Fit one head per task on the same frozen vectors. Predictions use normalized labels."""
    predictions = []
    trained = {}
    for head in ("issue", "sentiment", "urgency"):
        labels = [row[head] for row in train_rows]
        trained[head] = fitter(train_embeddings, labels)
    for index in range(len(test_embeddings)):
        row_x = test_embeddings[index : index + 1]
        predictions.append(
            {
                "issue": trained["issue"].predict(row_x)[0]
                if hasattr(trained["issue"], "predict")
                else predict_nearest_centroid(trained["issue"], row_x)[0],
                "sentiment": trained["sentiment"].predict(row_x)[0]
                if hasattr(trained["sentiment"], "predict")
                else predict_nearest_centroid(trained["sentiment"], row_x)[0],
                "urgency": trained["urgency"].predict(row_x)[0]
                if hasattr(trained["urgency"], "predict")
                else predict_nearest_centroid(trained["urgency"], row_x)[0],
            }
        )
    return predictions


def predict_centroid_heads(train_rows, train_embeddings, test_embeddings) -> list[dict]:
    def fitter(x, labels):
        model = fit_nearest_centroid(x, labels)

        class _Wrap:
            def predict(self, embeddings):
                return predict_nearest_centroid(model, embeddings)

        return _Wrap()

    return predict_heads(train_rows, train_embeddings, test_embeddings, fitter)


def predict_linear_heads(train_rows, train_embeddings, test_embeddings) -> list[dict]:
    return predict_heads(train_rows, train_embeddings, test_embeddings, fit_linear_probe)
