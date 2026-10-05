"""Parity tests for notebook metrics. No model download and no live API."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import numpy as np

from notebooks.baseline_b import checkpoint_status, resolve_api_base
from notebooks.cloze import clip_text_to_template, cloze_readiness
from notebooks.emoji_audit import audit_text, is_emoji_char, production_policy, strip_emoji, summarize_audits
from notebooks.gold import SMOKE_BANNER, GoldLoadError, find_leakage, load_labeled_file, resolve_labeled
from notebooks.metrics import (
    ISSUE_LABELS,
    SENTIMENT_LABELS,
    URGENCY_LABELS,
    class_f1,
    fmt_metric,
    format_comparison,
    metric_row,
    normalize_label,
    partial_triage,
    quadratic_weighted_kappa,
    score_head,
    score_urgency_ops,
    triage_metrics,
)
from notebooks.probe import fit_linear_probe, fit_nearest_centroid, holdout_n_shot, predict_nearest_centroid

ROOT = Path(__file__).resolve().parents[1]


class MetricsTests(unittest.TestCase):
    def test_label_sets_match_eval_readme(self):
        self.assertEqual(len(ISSUE_LABELS), 10)
        self.assertEqual(SENTIMENT_LABELS, ("negative", "not_negative"))
        self.assertEqual(tuple(URGENCY_LABELS), ("low", "medium", "emergency"))

    def test_normalize_label(self):
        self.assertEqual(normalize_label(" Not-Negative "), "not_negative")
        self.assertEqual(normalize_label("Airtel Money Reversal"), "airtel_money_reversal")

    def test_macro_f1_matches_hand_count(self):
        report = score_head(["a", "a", "b"], ["a", "b", "b"])
        self.assertEqual(report["correct"], 2)
        self.assertAlmostEqual(report["accuracy"], 2 / 3)
        self.assertAlmostEqual(report["macroF1"], 2 / 3)
        # A predicted-only class is not part of the macro average.
        only_fp = score_head(["a", "a"], ["a", "b"])
        self.assertAlmostEqual(only_fp["macroF1"], 2 / 3)
        self.assertAlmostEqual(only_fp["accuracy"], 0.5)
        self.assertIsNone(class_f1(only_fp, "b"))

    def test_urgency_ops_match_harness_cases(self):
        ops = score_urgency_ops(
            ["emergency", "emergency", "low", "medium"],
            ["emergency", "medium", "low", "emergency"],
        )
        self.assertEqual(ops["emergencyRecall"], 0.5)
        self.assertEqual(ops["falseEmergencyRate"], 0.5)
        self.assertEqual(ops["emergencyHits"], 1)
        self.assertIsNone(score_urgency_ops(["emergency"], ["emergency"])["falseEmergencyRate"])
        self.assertIsNone(score_urgency_ops(["low"], ["low"])["emergencyRecall"])
        self.assertEqual(score_urgency_ops(["low", "medium"], ["emergency", "emergency"])["falseEmergencyRate"], 1)
        self.assertEqual(score_urgency_ops(["emergency", "emergency"], ["low", "medium"])["emergencyRecall"], 0)
        normalized = score_urgency_ops(["Emergency", "LOW"], [" emergency ", "Low"])
        self.assertEqual(normalized["emergencyRecall"], 1)
        self.assertEqual(normalized["falseEmergencyRate"], 0)

    def test_kappa_perfect_and_ordinal(self):
        labels = ["low", "medium", "emergency", "low"]
        self.assertEqual(quadratic_weighted_kappa(labels, labels), 1)
        gold = ["low", "low", "emergency", "emergency"]
        adjacent = quadratic_weighted_kappa(gold, ["medium", "medium", "medium", "medium"])
        opposite = quadratic_weighted_kappa(gold, ["emergency", "emergency", "low", "low"])
        self.assertGreater(adjacent, opposite)
        self.assertIsNone(quadratic_weighted_kappa(["unknown"], ["mystery"]))

    def test_triage_metrics_require_alignment(self):
        gold = [{"issue": "a", "sentiment": "negative", "urgency": "low"}]
        with self.assertRaises(ValueError):
            triage_metrics(gold, [])

    def test_partial_triage_leaves_unscored_heads_blank(self):
        gold = [
            {"issue": "a", "sentiment": "negative", "urgency": "low"},
            {"issue": "b", "sentiment": "negative", "urgency": "emergency"},
        ]
        partial = partial_triage(gold, urgency_pred=["low", "emergency"])
        self.assertIsNone(partial["issue_macro_f1"])
        self.assertIsNone(partial["sentiment_macro_f1"])
        self.assertEqual(partial["emergency_recall"], 1)
        self.assertEqual(partial["urgency_quadratic_kappa"], 1)

    def test_comparison_table_does_not_invent_numbers(self):
        text = format_comparison([metric_row("frozen encoder", "not run", None)])
        self.assertIn("n/a", text)
        self.assertIn("issue macro-F1", text)
        self.assertEqual(fmt_metric(None), "n/a")
        self.assertEqual(fmt_metric(1), "1.000")


class NodeParityTests(unittest.TestCase):
    def test_python_metrics_match_node_harness(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("node is not installed")
        cases = [
            {"gold": ["a", "a", "b"], "pred": ["a", "b", "b"]},
            {"gold": ["a", "a"], "pred": ["a", "b"]},
            {"gold": ["Emergency", "LOW", "medium"], "pred": [" emergency ", "low", "emergency"]},
            {"gold": ["low", "low", "emergency", "emergency"], "pred": ["medium", "medium", "medium", "medium"]},
            {"gold": ["low", "medium", "emergency", "low"], "pred": ["low", "medium", "emergency", "low"]},
            {"gold": ["Not-Negative", "negative"], "pred": ["not_negative", "negative"]},
        ]
        run_url = (ROOT / "eval" / "run.mjs").as_uri()
        ops_url = (ROOT / "eval" / "urgency-ops.mjs").as_uri()
        script = f"""
import {{ scoreHead }} from {json.dumps(run_url)};
import {{ quadraticWeightedKappa, scoreUrgencyOps }} from {json.dumps(ops_url)};
const cases = JSON.parse(process.argv[2]);
const out = cases.map((c) => ({{
  head: scoreHead(c.gold, c.pred),
  ops: scoreUrgencyOps(c.gold, c.pred),
  kappa: quadraticWeightedKappa(c.gold, c.pred),
}}));
process.stdout.write(JSON.stringify(out));
"""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "parity.mjs"
            path.write_text(script, encoding="utf-8")
            completed = subprocess.run(
                [node, str(path), json.dumps(cases)],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout).strip()
            if "ERR_MODULE_NOT_FOUND" in detail or "Cannot find module" in detail:
                self.skipTest(f"node parity import failed: {detail}")
            self.fail(detail)
        node_out = json.loads(completed.stdout)
        for case, got in zip(cases, node_out):
            report = score_head(case["gold"], case["pred"])
            self.assertAlmostEqual(report["macroF1"], got["head"]["macroF1"])
            self.assertAlmostEqual(report["accuracy"], got["head"]["accuracy"])
            self.assertEqual(report["correct"], got["head"]["correct"])
            ops = score_urgency_ops(case["gold"], case["pred"])
            self.assertEqual(ops["emergencyRecall"], got["ops"]["emergencyRecall"])
            self.assertEqual(ops["falseEmergencyRate"], got["ops"]["falseEmergencyRate"])
            self.assertEqual(ops["emergencyHits"], got["ops"]["emergencyHits"])
            kappa = quadratic_weighted_kappa(case["gold"], case["pred"])
            if kappa is None:
                self.assertIsNone(got["kappa"])
            else:
                self.assertAlmostEqual(kappa, got["kappa"])


class GoldTests(unittest.TestCase):
    def test_smoke_fixture_loads_twenty_two_rows(self):
        loaded = load_labeled_file(ROOT / "eval" / "synthetic-heldout.smoke.csv")
        self.assertTrue(loaded["smoke"])
        self.assertEqual(len(loaded["rows"]), 22)
        self.assertEqual(loaded["rows"][0]["id"], "s01")
        self.assertEqual(loaded["rows"][0]["issue"], "Airtel_Money_Reversal")
        self.assertEqual(loaded["skipped"], [])

    def test_comments_and_missing_columns(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "gold.csv"
            path.write_text(
                "# comment\nID,Text,Issue,Sentiment,Urgency\n"
                "1,hello,Network_Issues,negative,low\n"
                "2,,Network_Issues,negative,low\n",
                encoding="utf-8",
            )
            loaded = load_labeled_file(path)
            self.assertEqual(len(loaded["rows"]), 1)
            self.assertEqual(loaded["rows"][0]["id"], "1")
            self.assertEqual(len(loaded["skipped"]), 1)
            bad = Path(tmp) / "bad.csv"
            bad.write_text("message,issue\nhello,x\n", encoding="utf-8")
            with self.assertRaises(GoldLoadError) as caught:
                load_labeled_file(bad)
            self.assertIn("text", str(caught.exception))

    def test_resolve_requires_an_explicit_gold_file(self):
        resolved = resolve_labeled({}, ROOT, "gold")
        self.assertIsNone(resolved["rows"])
        self.assertIn("gold_csv", resolved["reason"])
        smoke = resolve_labeled({"allow_smoke_fixture": True}, ROOT, "gold")
        self.assertEqual(len(smoke["rows"]), 22)
        self.assertIn("SYNTHETIC SMOKE", smoke["warning"])
        self.assertIn("SYNTHETIC SMOKE", SMOKE_BANNER)

    def test_leakage_blocks_shared_text(self):
        train = [{"id": "t", "text": "same message"}]
        test = [{"id": "s", "text": "same   message"}]
        problems = find_leakage(train, test)
        self.assertTrue(problems)
        self.assertFalse(find_leakage(train, [{"id": "s", "text": "other"}]))


class ProbeTests(unittest.TestCase):
    def _rows(self):
        rows = []
        for issue in ("a", "b"):
            for i in range(5):
                rows.append(
                    {
                        "id": f"{issue}{i}",
                        "text": f"{issue} message {i}",
                        "issue": issue,
                        "sentiment": "negative",
                        "urgency": "low",
                    }
                )
        return rows

    def test_holdout_is_disjoint_and_deterministic(self):
        rows = self._rows()
        train_a, test_a, _notes = holdout_n_shot(rows, n_per_issue=2, seed=0)
        train_b, test_b, _notes = holdout_n_shot(rows, n_per_issue=2, seed=0)
        self.assertEqual([row["id"] for row in train_a], [row["id"] for row in train_b])
        self.assertEqual([row["id"] for row in test_a], [row["id"] for row in test_b])
        self.assertEqual(len(train_a), 4)
        self.assertEqual(len(test_a), 6)
        self.assertFalse({row["id"] for row in train_a} & {row["id"] for row in test_a})

    def test_small_class_is_not_consumed_by_the_fit(self):
        rows = [
            {"id": "1", "text": "one", "issue": "a", "sentiment": "negative", "urgency": "low"},
            {"id": "2", "text": "two", "issue": "a", "sentiment": "negative", "urgency": "low"},
        ]
        train, test, notes = holdout_n_shot(rows, n_per_issue=2, seed=0)
        self.assertEqual(train, [])
        self.assertEqual(len(test), 2)
        self.assertTrue(notes)

    def test_centroid_separates_axes(self):
        embeddings = np.array([[1.0, 0.0], [0.9, 0.1], [0.0, 1.0]], dtype=np.float64)
        model = fit_nearest_centroid(embeddings, ["a", "a", "b"])
        preds = predict_nearest_centroid(model, np.array([[0.8, 0.2], [0.2, 0.8]], dtype=np.float64))
        self.assertEqual(preds, ["a", "b"])

    def test_linear_probe_separates_axes(self):
        embeddings = np.array([[0.0], [0.0], [1.0], [1.0]], dtype=np.float64)
        probe = fit_linear_probe(embeddings, ["no", "no", "yes", "yes"])
        preds = probe.predict(np.array([[0.0], [1.0]], dtype=np.float64))
        self.assertEqual(preds, ["no", "yes"])


class ClozeTests(unittest.TestCase):
    def test_clip_keeps_one_mask(self):
        class CharTok:
            mask_token = "<mask>"
            mask_token_id = 1
            unk_token_id = 3

            def encode(self, text, add_special_tokens=True):
                ids = [0] if add_special_tokens else []
                i = 0
                while i < len(text):
                    if text.startswith("<mask>", i):
                        ids.append(1)
                        i += len("<mask>")
                    else:
                        ids.append(10)
                        i += 1
                if add_special_tokens:
                    ids.append(2)
                return ids

        tokenizer = CharTok()
        template = "{text} <mask>"
        clipped = clip_text_to_template(tokenizer, "x" * 50, template, max_length=20)
        self.assertLess(len(clipped), 50)
        filled = template.replace("{text}", clipped)
        ids = tokenizer.encode(filled, add_special_tokens=True)
        self.assertLessEqual(len(ids), 20)
        self.assertEqual(ids.count(1), 1)

    def test_readiness_rejects_multi_piece_labels(self):
        class Tok:
            unk_token_id = 3

            def encode(self, text, add_special_tokens=False):
                return [4] if text == "low" else [5, 6]

            def convert_ids_to_tokens(self, ids):
                return [f"p{i}" for i in ids]

        ready = cloze_readiness(Tok(), ["low", "emergency"])
        self.assertFalse(ready["ready"])
        self.assertIn("emergency", ready["reason"])


class EmojiTests(unittest.TestCase):
    def test_strip_leaves_plain_text_and_removes_emoji(self):
        self.assertEqual(strip_emoji("line 5 is down"), "line 5 is down")
        self.assertEqual(strip_emoji("please reverse 🙏 now"), "please reverse now")
        self.assertFalse(any(is_emoji_char(ch) for ch in strip_emoji("family 👨‍👩‍👧 bundle")))

    def test_unk_versus_real_token(self):
        class UnkTok:
            unk_token_id = 3

            def __call__(self, text, add_special_tokens=True):
                ids = [0]
                for ch in text:
                    ids.append(3 if is_emoji_char(ch) else 11)
                ids.append(2)
                return {"input_ids": ids}

            def convert_ids_to_tokens(self, ids):
                return ["<unk>" if i == 3 else ("<s>" if i == 0 else "</s>" if i == 2 else "w") for i in ids]

        class RealTok(UnkTok):
            def __call__(self, text, add_special_tokens=True):
                ids = [0]
                for ch in text:
                    ids.append(99 if is_emoji_char(ch) else 11)
                ids.append(2)
                return {"input_ids": ids}

            def convert_ids_to_tokens(self, ids):
                out = []
                text_emoji = "🙏"
                for i in ids:
                    if i == 99:
                        out.append(text_emoji)
                    elif i == 0:
                        out.append("<s>")
                    elif i == 2:
                        out.append("</s>")
                    else:
                        out.append("w")
                return out

        unk = audit_text(UnkTok(), "please reverse 🙏")
        self.assertEqual(unk["status"], "unk")
        real = audit_text(RealTok(), "please reverse 🙏")
        self.assertEqual(real["status"], "real_tokens")
        policy = production_policy(summarize_audits([unk]))
        self.assertIn("Do not strip", policy)
        self.assertIn("keep emoji", policy.lower())


class BaselineBTests(unittest.TestCase):
    def test_checkpoint_is_not_loaded(self):
        status = checkpoint_status("")
        self.assertFalse(status["loaded"])
        self.assertIn("/data/ckpt/joint_big_model.pt", status["modal_checkpoint_reported_by_health"])
        self.assertIn("not unpickled", status["reason"])

    def test_api_base_fallback(self):
        self.assertTrue(resolve_api_base("").startswith("https://"))
        self.assertEqual(resolve_api_base("https://example.test/"), "https://example.test")


if __name__ == "__main__":
    unittest.main()
