# Notebooks

Local checks for Chris. They do not replace `eval/`, and they do not train the three-head model. There is no training notebook in this repo to copy; training stays in the Modal codebase.

Run them from the repo root:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r notebooks/requirements.txt
python3 -m unittest notebooks.test_metrics -v
jupyter lab notebooks/01_prompted_afroxlmr_baseline.ipynb
```

`python3 -m unittest notebooks.test_metrics -v` does not download a model and does not call the API. It checks that the Python metrics match `eval/run.mjs` and `eval/urgency-ops.mjs`.

The first cell of each notebook also works if the kernel's working directory is `notebooks/`.

## What each notebook is for

| File | Question |
| --- | --- |
| `01_prompted_afroxlmr_baseline.ipynb` | On one labeled file, how does a frozen `Davlan/afro-xlmr-large` compare with the deployed three-head checkpoint? |
| `02_emoji_tokenization_audit.ipynb` | Does that tokenizer keep emoji as pieces, or turn them into `<unk>`? |

`01` is a comparison, not a claim that `joint_big_model.pt` was fine-tuned from AfroXLMR. This repo never names that checkpoint's backbone. Baseline B is whatever `POST /predict_batch` returns.

AfroXLMR-large is an encoder-only XLM-RoBERTa, adapted with masked language modeling (Alabi et al. 2022, [Davlan/afro-xlmr-large](https://huggingface.co/Davlan/afro-xlmr-large)). It is not a chat model. The notebook tries fill-mask cloze only when every class name is one vocab token. When that is not true, it does not invent a verbalizer. The fair run that remains is a frozen encoder plus a nearest centroid or a linear probe fit only on a disjoint N-shot file.

Urgency on Baseline B is the decoded label `low` / `medium` / `emergency`. The training setup describes that head as CORN. The CORN module is not in this repo, so the notebook does not reconstruct it.

## Data paths

Same columns as [eval/README.md](../eval/README.md): `text`, `issue`, `sentiment`, `urgency`, optional `id`.

| What | Where to point CONFIG | Do not commit |
| --- | --- | --- |
| Gold / val CSV | `gold_csv` — the same file you pass to `node eval/run.mjs --csv` | yes |
| Gold / val xlsx | `gold_xlsx` plus `xlsx_sheet` (needs `pandas` and `openpyxl`) | yes |
| Few-shot rows for the frozen probe | `fewshot_csv` or `fewshot_xlsx`, disjoint from gold | yes |
| Modal checkpoint | health reports `/data/ckpt/joint_big_model.pt`. A local `.pt` can be named in `local_checkpoint` or `MULTIHEAD_CKPT` | yes, and the notebook will not `torch.load` it |
| Synthetic smoke | `allow_smoke_fixture: True` uses `eval/synthetic-heldout.smoke.csv` | already in git; not gold |

This repo does not record a gold filename on the Modal volume. If the labeled export lives next to the checkpoint, mount that volume and set `gold_csv` to the file you already trust. Do not guess a path.

`call_live_api`, `run_frozen_encoder`, and the cloze flags default to false, so Run All does not download the encoder or call Modal until you opt in. Until then the comparison table prints `n/a`. Those are not metrics.

## Never commit customer PII

- Do not commit raw customer xlsx/csv, `.pt` weights, or notebook outputs that contain message text.
- `.gitignore` already ignores `*.xlsx`, `*.xls`, `*.pt`, `*.pth`, `*.ckpt`, `*.safetensors`, `/data/`, `notebooks/outputs/`, and `.ipynb_checkpoints/`.
- Leave message text out of saved JSON. The comparison writer stores labels and metrics, not `text`.
- Do not paste customer messages into cells, and do not commit an executed notebook that still shows them.

## Metrics

On the scored rows (the full gold file, or the remainder after an opt-in N-shot split):

- issue macro-F1
- sentiment macro-F1, plus F1 of the `negative` class
- urgency quadratic-weighted Cohen's κ
- emergency recall (and the harness's false-emergency rate)

Macro-F1 is the unweighted mean of per-class F1 over gold labels with support, matching `eval/run.mjs`. Both systems in a row of the table use the same rows. A head that was not scored stays `n/a`.
