# Build Prompt — bio-authN Phase 1 (Eval Harness)

> Paste this into a coding agent (Claude Code / Cursor) as the spec for Phase 1. It is self-contained. Read `ATLAS.md` and `CONTEXT.md` in this repo for domain grounding before starting. Where this prompt and `CONTEXT.md` disagree, **this prompt wins** — it reflects the agreed v1 scope.
>
> **v1 is deliberately lean: two matchers, matching track only.** InsightFace and the PAD track are v2 — both are pure additions over the contracts frozen here (see §10). Building the harness on one task first is the point; don't pull v2 forward.

---

## 0. What you are building

An **eval-first** harness for selfie biometric authentication. It is not a login flow. It takes a synthetic face corpus, runs two face matchers over genuine/impostor pairs, and computes accuracy / fairness / calibration / cost / latency metrics, emitting one versioned JSON result that a single-file static dashboard renders.

There is **no camera, no enrollment, no step-up UI, no auth database, no liveness/PAD** in Phase 1. Those are later phases and will reuse the contracts you freeze here.

### Success in one command

```bash
python eval/run_eval.py --config config/eval.yaml
# -> results/eval_run.json  (schema-valid)
# -> results/pairs_raw.csv  (per-comparison rows)
# open dashboard/index.html -> renders every metric from that JSON, offline
```

---

## 1. Non-goals (do not build these in Phase 1)

- No webcam, MediaPipe, liveness UI, or React frontend.
- No enrollment / step-up / auth flow.
- No SQLite auth-event log (the run manifest is the only persistence).
- **No PAD / liveness track** — deferred to v2. Keep the `task_type` field in the contracts (§2) so it adds cleanly later, but generate no attacks and write no `pad` rows.
- **No InsightFace** — deferred to v2. ArcFace is the only embedding matcher in v1.
- No multi-modal (voice, behavioural).
- No hosting/deployment work.

If a task tempts you toward any of the above, stop and leave a `# v2` comment instead.

---

## 2. The two frozen contracts

Everything later is additive **only if** these two shapes do not change. Implement them first, exactly. They intentionally include fields (`task_type`, `pad`, `calibration`) that v1 leaves unused — that is what makes v2 zero-churn. Do not remove them.

### 2.1 MatcherAdapter interface (`engine/adapters/base.py`)

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional

@dataclass
class MatchResult:
    matcher_id: str                 # e.g. "arcface", "vlm_claude"  (v2: "insightface", "pad_baseline", "pad_vlm")
    task_type: str                  # "match" | "pad"   (v1 only ever emits "match")
    score: float                    # higher = more genuine (match) / more live (pad)
    decision: bool                  # adapter's own call at its default threshold; harness re-decides at tuned threshold
    confidence: Optional[float]     # model-stated confidence in [0,1], or None
    reasoning: Optional[str]        # natural-language rationale (VLM only), else None
    tokens_in: int                  # 0 for non-LLM adapters
    tokens_out: int                 # 0 for non-LLM adapters
    cost_usd: float                 # 0.0 for local adapters
    latency_ms: int

class MatcherAdapter(ABC):
    matcher_id: str
    task_type: str                  # "match" or "pad"

    @abstractmethod
    def run(self, reference, probe) -> MatchResult:
        """match: reference+probe are images (or precomputed embeddings).
           pad:   probe is the sample, reference is None.   (pad is v2)"""
        ...

    # Optional fast path for embedding matchers; harness caches the output.
    def embed(self, image):
        raise NotImplementedError
```

Rules: adapters never decide policy. They return a raw `score` and their own naive `decision`; the **harness** applies the tuned operating threshold. The `accounting.py` wrapper times every `run()` call and fills `latency_ms`; LLM adapters fill `tokens_*` and `cost_usd` from the API response usage.

### 2.2 Result schema (`eval/schema.py`, `schema_version: "1.0"`)

```json
{
  "schema_version": "1.0",
  "run": {
    "id": "uuid",
    "timestamp": "ISO-8601",
    "git_sha": "string",
    "config_hash": "sha256 of resolved config",
    "corpus_version": "string from manifest",
    "vlm_mode": "local | api | cli"
  },
  "matchers": [
    {
      "matcher_id": "arcface",
      "task_type": "match",
      "operating_threshold": 0.0,
      "overall": {
        "far": 0.0, "frr": 0.0, "eer": 0.0, "auc": 0.0,
        "tar_at_far": {"1e-2": 0.0, "1e-3": 0.0}
      },
      "roc": [{"threshold": 0.0, "far": 0.0, "frr": 0.0, "tar": 0.0}],
      "by_group": [{"group": "string", "frr": 0.0, "far": 0.0, "n_pairs": 0}],
      "disparity_ratio": 0.0,
      "calibration": {"ece": 0.0, "bins": [{"conf": 0.0, "acc": 0.0, "n": 0}]},
      "pad": null,
      "cost": {"calls": 0, "tokens_in": 0, "tokens_out": 0, "usd_total": 0.0, "usd_per_decision": 0.0},
      "latency_ms": {"p50": 0, "p95": 0}
    }
  ],
  "disagreement": {
    "uncertain_band": [0.55, 0.75],
    "n_in_band": 0,
    "vlm_correct_in_band": 0,
    "examples": [{"pair_id": "string", "arcface_score": 0.0, "vlm_decision": true, "label": "genuine"}]
  }
}
```

`calibration` is null for non-LLM matchers. `pad` is **always null in v1** (the field stays for v2). Validate every emitted file against this schema with `jsonschema` before writing — fail loudly if it doesn't conform.

`pairs_raw.csv` columns: `pair_id, matcher_id, task_type, ref_id, probe_id, group, label, score, decision, confidence, tokens_in, tokens_out, cost_usd, latency_ms`. (`label` ∈ {genuine, impostor} in v1.)

---

## 3. Corpus (`corpus/build_corpus.py` → `corpus/manifest.json`)

Deterministic, seeded, reproducible. Running it twice with the same seed yields the same manifest.

1. **Download — DigiFace-1M, the 10K-identity × 72-images-per-identity partition** (not the 100K×5 partition, which has too few images per identity for our 6). It is rendered with balanced demographic attributes, which is what the bias panel needs; generative sets (DCFace/SynFace) carry their training data's demographic skew and would make the bias audit circular. Pull only the smallest archive that holds ≥150 identities and extract the 900 images, **or** stream from a Hugging Face mirror and stop once 150×6 are collected — do **not** download the full multi-GB dataset. Confirm the license permits research use before fetching. **Fallback order if DigiFace is blocked: DCFace, then SynFace (ETH)** — both permissive research licenses, multiple images per identity; if used, note in the manifest that the bias panel now carries generative-corpus skew on top of the FairFace caveat. Do **not** generate faces.
2. Select **150 identities × 6 images = 900 images**.
3. **Label demographics** on each image with a fairness attribute classifier (FairFace): coarse buckets for skin-tone/race, sex, age. Record per-image labels in the manifest. Leave a clear caveat in the manifest and README: FairFace is trained on real faces, so labels on synthetic faces are approximate — the bias panel demonstrates method, not a publishable audit.
4. **Build pair lists:**
   - Genuine: all within-identity pairs → 15/identity × 150 = **2,250**.
   - Impostor: random cross-identity sample, seeded → **7,500**.
   - VLM subset: stratified sample of **240 pairs** (120 genuine / 120 impostor, balanced across demographic buckets) flagged `vlm_subset: true`.

`manifest.json` records: corpus_version (hash of identity selection + seed), source dataset name, partition, archive name, and license string, per-identity image paths, per-image demographic labels, and all pair lists with flags. Images live in `corpus/data/` (gitignored).

*(v2 will add ~200 bona-fide + ~200 simulated-attack PAD samples and a `corpus/attacks.py`. Do not build it now.)*

---

## 4. Matchers (v1 set)

| matcher_id | task | impl | calls out | notes |
|---|---|---|---|---|
| `arcface` | match | DeepFace (ArcFace), 512-d, cosine | none | production truth; cache embeddings |
| `vlm_claude` | match | Claude Messages API (2 images + structured prompt) | api mode only | research path; returns decision+confidence+reasoning |

VLM mode is config-driven via `vlm_mode`, with three transports behind one adapter contract — same prompt, same parsing, same `MatchResult`; only how the request reaches a model differs:

- **`local`** — POST to an Ollama LLaVA endpoint on localhost. Free, for development/plumbing. Open ~7–13B model, so quality/calibration are weaker; do not publish these numbers.
- **`api`** — Anthropic Messages API (`anthropic` SDK). Frontier quality, real token usage from the response, ~$2–3/run. Requires an API key.
- **`cli`** — shell out to Claude Code headless per pair: `claude -p "<prompt>" --output-format json` (add `--dangerously-skip-permissions` for unattended runs). Uses the user's existing Claude Code auth, **no API key needed**. Parse stdout JSON: take the model's answer from `result`, and read the per-invocation cost into `cost_usd` — the field name varies by CLI version, so try `cost_usd` first, then `total_cost_usd`, and log 0.0 if neither is present (verify against your installed Claude Code version). Frontier quality without API billing; trade-off is per-call agent spin-up latency and slight agent overhead vs a raw model call — note this caveat in any writeup. This is the recommended transport for the publishable run when no Anthropic API key is available.

Implement transports as thin modules: `engine/adapters/vlm_claude.py` (api), `vlm_local.py` (local Ollama), `vlm_cli.py` (Claude Code headless). The VLM prompt must request strict JSON (`{"same_person": bool, "confidence": 0-1, "reasoning": "..."}`) and parse defensively. `local`/`cli` populate `cost_usd` as 0.0 / from the CLI's `total_cost_usd` respectively; `api` from response usage.

Adapters register via `engine/registry.py` driven by `config/eval.yaml` (on/off per matcher). ArcFace embeddings are computed once per image and cached to disk, so the ~9,750 match comparisons are just cosine ops. At ~240 VLM calls per run, `api` mode costs roughly **$2–3/run**; `local` mode is free.

*(v2 adds `insightface` here as a second embedding matcher — one adapter file + a config flag, no other change.)*

---

## 5. Metrics (`eval/metrics.py`)

Implement from first principles (use scikit-learn for ROC/AUC only):

- **FAR/FMR** = impostor pairs accepted / total impostor pairs, at threshold t.
- **FRR/FNMR** = genuine pairs rejected / total genuine pairs, at threshold t.
- **Threshold sweep** → `roc` array; **EER** where FAR≈FRR; **AUC** via sklearn.
- **TAR@FAR** at FAR=1e-2 and 1e-3 (note in output if corpus can't resolve 1e-3 cleanly).
- **Operating threshold**: pick at a configured target FAR (default 1e-2); record it.
- **Demographic differential**: FRR and FAR per group at the operating threshold; **disparity_ratio** = worst-group FRR ÷ best-group FRR. Guard the divide: if best-group FRR is 0 (possible at ~25 identities/bucket and a tight threshold), emit `disparity_ratio: null` with a note — same treatment as an unresolvable TAR@1e-3.
- **Calibration** (VLM only): bin by stated confidence, compare to empirical accuracy; report reliability bins + **ECE**.
- **Cost**: sum calls/tokens/usd per matcher; **usd_per_decision** = usd_total / calls.
- **Latency**: p50/p95 from per-call `latency_ms`.
- **Disagreement / uncertain band**: within the configured ArcFace score band (default 0.55–0.75 cosine), count pairs, and of those, how often the VLM called it correctly. This is the headline "where does a VLM second opinion earn its tokens" result.

State the statistical caveat in the dashboard: ~25 identities/bucket gives trend-level bias signal, not tight CIs.

*(v2 adds APCER/BPCER/ACER for the PAD track.)*

---

## 6. Dashboard (`dashboard/index.html`)

Single self-contained HTML file. Loads `results/eval_run.json` (fetch, with a file-input fallback for `file://`). One chart library from CDN is fine (Chart.js). Tabs:

1. **Overview** — run metadata, matcher summary table (FAR/FRR/EER/AUC/cost/latency), the headline disagreement stat.
2. **Matching** — ROC + DET curves, FAR-vs-FRR-vs-threshold, per matcher.
3. **Bias** — per-group FRR/FAR bars + disparity ratio, with the caveat banner.
4. **Calibration** — VLM reliability curve + ECE.
5. **Cost & Latency** — tokens, $/decision, p50/p95 per matcher.
6. **Disagreement** — uncertain-band visual + example pairs.

It must open offline and render real numbers from the JSON. This file is the public-shareable artifact — keep it clean. **Public build shows scores and pair IDs only — no face thumbnails — to avoid any dataset redistribution-license issue; render face thumbnails only in a local/private variant of the dashboard.** *(v2 adds a PAD tab.)*

---

## 7. Config & provenance

`config/eval.yaml` (policy-as-config — no code change to re-run differently):

```yaml
seed: 42
corpus:
  n_identities: 150
  images_per_identity: 6
  impostor_pairs: 7500
  vlm_subset_pairs: 240
matchers:
  arcface: true
  vlm_claude: true
vlm_mode: local            # local (Ollama LLaVA, dev) | api (Anthropic key) | cli (Claude Code headless, no key)
thresholds:
  target_far: 0.01
  uncertain_band: [0.55, 0.75]
far_targets: [0.01, 0.001]
```

Run `git init` before the first build so provenance works from day one; if the directory is not a git repo (or has no commits yet), the harness writes `git_sha = "not-a-git-repo"` rather than failing. Every run writes `run` metadata (id, timestamp, git_sha, config_hash, corpus_version, vlm_mode) into the JSON. That manifest is the governance seed later phases build on.

---

## 8. Repo layout

```
bio-authn/
├── ATLAS.md  CONTEXT.md  README.md  BUILD_PROMPT_PHASE1.md
├── requirements.txt
├── config/eval.yaml
├── corpus/
│   ├── build_corpus.py   manifest.json   data/  (gitignored)
├── engine/
│   ├── adapters/ base.py arcface.py vlm_claude.py vlm_local.py vlm_cli.py
│   ├── registry.py   accounting.py
├── eval/
│   ├── run_eval.py   metrics.py   schema.py
├── dashboard/index.html
└── results/  eval_run.json  pairs_raw.csv
```

`requirements.txt`: python 3.11, deepface, torch, torchvision (FairFace is a PyTorch ResNet-34), numpy, scikit-learn, pandas, pillow, anthropic, requests, pyyaml, jsonschema. (FairFace weights fetched by `build_corpus.py`.) *(v2 adds insightface, onnxruntime, opencv-python.)*

---

## 9. Build order & acceptance

1. **Setup** — `git init` (provenance; harness falls back to `git_sha = "not-a-git-repo"` if absent), add `.gitignore` (`corpus/data/`, `results/*.csv`, `__pycache__/`, `models/`), then `pip install -r requirements.txt`.
2. **Contracts** — `base.py` (MatchResult + ABC), `schema.py` (schema + validator). Nothing else compiles against anything unfrozen.
3. **Corpus** — download, select 150×6, FairFace labels, pair lists → valid `manifest.json`.
4. **Adapters + accounting** — ArcFace (cached embeddings) and VLM (local first). Each returns a valid `MatchResult`.
5. **Harness** — `run_eval.py` runs the match track → `metrics.py` → schema-valid `eval_run.json` + `pairs_raw.csv`.
6. **Dashboard** — all six tabs render from the JSON offline.

**Acceptance:** the one command in §0 produces a schema-valid result with real numbers for both matchers; the dashboard opens offline and shows every tab; total VLM cost is logged in the JSON; rerunning with the same seed reproduces the corpus and pair lists; switching `vlm_mode` between `local`, `api`, and `cli` needs only a config edit; flipping either matcher off in config drops it cleanly from results.

Keep functions typed and seeded. The only outbound network calls in the entire system are the VLM adapter in `api` mode and the one-time corpus/model downloads. If you find yourself adding any other external call, stop and flag it.

---

## 10. v2 (planned, not now)

Both are pure additions over the frozen contracts — listed so you build v1 in a way that doesn't block them, **not** to build now:

- **InsightFace (Buffalo_L)** — second embedding matcher. One adapter file + config flag. Enables model-vs-model accuracy comparison.
- **PAD / liveness track** — `corpus/attacks.py` generating ~200 simulated print/screen attacks over ~200 bona-fide samples; a `pad_baseline` (frequency/texture) adapter and a `pad_vlm` (Claude passive-liveness) adapter; APCER/BPCER/ACER metrics; a PAD dashboard tab. Slots in via `task_type="pad"` with no change to the match path.

If v1 is built to this spec, v2 touches new files plus config — nothing existing.
