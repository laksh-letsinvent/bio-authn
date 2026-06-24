# Build Prompt — bio-authN v2 (PAD / liveness track + InsightFace)

> Paste into a coding agent after Phase 1 + Phase 2. Read `CLAUDE.md`, `THREAT_MODEL.md`, `EVAL_METRICS.md`, and `PHASE_1_5.md` first. v2 is **purely additive over the two frozen contracts** — new files plus config, touching nothing existing. It also folds in the *free* (no-VLM) Phase 1.5 corrections while the corpus/eval code is open. No live camera, no real attacks.

---

## 0. What v2 adds

1. **PAD / liveness eval track** — a second `task_type` (`"pad"`), evaluating liveness detection against *simulated* presentation attacks. This is the security half of biometrics: matching is solved, liveness is where systems get attacked.
2. **InsightFace** — a second embedding matcher for model-vs-model comparison on the matching track.
3. **Folded Phase 1.5 fixes** — relocate the uncertain band (threshold-relative) and rebalance the corpus demographics. Both are free (no VLM calls).

The `task_type` and `pad` fields reserved in v1 now carry real data. **Validate every emitted file against the unchanged `schema_version: "1.0"`** — if it no longer validates, you've broken a contract; stop and raise it.

## 1. Scope

**In:** the PAD corpus + two PAD adapters + PAD metrics; the InsightFace adapter; the two folded Phase 1.5 fixes; portal updates to surface measured PAD + InsightFace.

**Out (do not build):**
- No live camera / MediaPipe / capture flow — that's Phase 3.
- No real presentation attacks — *simulated* print/screen degradations only, labelled as such. Not iBeta-grade.
- No change to the `MatcherAdapter` interface or the result schema.
- The ~$12 VLM **matching** re-run (`PHASE_1_5.md` Fix 3) stays parked — but see §6 for amortising it if you're paying for PAD VLM calls anyway.

## 2. Corpus additions (`corpus/attacks.py`)

Deterministic, seeded. Adds to `manifest.json`; touches no existing pair lists.

- **Bona-fide set:** 200 genuine images sampled from the corpus, labelled `bonafide`.
- **Simulated attacks:** 200 generated from genuine images — ~100 `print` (paper texture overlay, slight blur, desaturation, re-quantisation) and ~100 `screen` (moiré, screen-door, mild specular, optional bezel crop). Implement with OpenCV/PIL; keep deterministic.
- **PAD VLM subset:** flag ~200 PAD samples (100 bonafide / 100 attack) `pad_vlm_subset: true` to bound VLM cost.
- Record attack type per sample in the manifest. Note clearly: these are simulated PAIs for exercising the metrics, not real-world attacks.

## 3. New adapters

| matcher_id | task | impl | calls out | notes |
|---|---|---|---|---|
| `insightface` | match | InsightFace Buffalo_L (`w600k_r50`), ONNX, cosine | none | second embedding model; cache embeddings like ArcFace |
| `pad_baseline` | pad | frequency/texture detector (FFT high-freq energy + LBP-style variance) → liveness score | none | cheap deterministic specialist baseline |
| `pad_vlm` | pad | Claude passive-liveness prompt (1 image) → `{live, confidence, reasoning}` | `api`/`cli` only | VLM-as-PAD; same transports as v1 (`local`/`api`/`cli`) |

All return the standard `MatchResult`. For `pad`, `reference` is `None` and `probe` is the sample. PAD adapters set `task_type="pad"`; the harness scores them against the bona-fide/attack labels. Everything runs through the existing `accounting.py` wrapper.

## 4. PAD metrics (`eval/metrics.py`, additive)

Compute over the PAD set, by liveness score threshold:

- **APCER** = attacks accepted as live ÷ attacks (security failure).
- **BPCER** = bona-fide rejected as attacks ÷ bona-fide (friction failure).
- **ACER** = (APCER + BPCER) / 2.
- **PAD ROC** + operating point; **VLM calibration** (ECE) on the PAD task; **cost/latency** per PAD matcher.
- Emit into the `pad` block of the schema (null for `task` matchers, populated for `pad`). Guard divide-by-zero the same way as `disparity_ratio` / TAR@1e-3.

## 5. Folded Phase 1.5 fixes (free — do these here)

- **Uncertain band → threshold-relative** (`PHASE_1_5.md` Fix 1): config `uncertain_band_mode: relative`, `uncertain_band_margin: 0.07`; band = `[op_thr − margin, op_thr + margin]`. Pure recompute, no VLM.
- **Corpus rebalance** (`PHASE_1_5.md` Fix 2): re-select 150 identities stratified to balance sex and to populate skin-tone + age buckets; `by_group` must emit all three axes, not sex alone. Re-run ArcFace + InsightFace (both free, local).

## 6. The parked VLM matching re-run (optional amortise)

`PHASE_1_5.md` Fix 3 (re-target the matching VLM subset to the relocated band, ~$12, ~40 min) stays parked. But if you're spending on `pad_vlm` calls in this session anyway, running both VLM jobs together amortises the setup — note it as a one-session option, not a requirement.

## 7. Portal updates (Phase 2 portal)

- **Liveness / PAD section:** upgrade from illustrative to **measured** — wire real APCER/BPCER/ACER and the PAD ROC. Keep the spot-the-attack explainer; add the measured numbers beneath it.
- **Findings:** add a **PAD tab** (APCER/BPCER/ACER, PAD ROC, baseline vs VLM, PAD cost/latency).
- **Matching + Findings:** show **InsightFace** alongside ArcFace (model-vs-model ROC/accuracy). The matching explainer can offer it as a second matcher toggle.
- Reuse the locked design tokens — no theme work here.

## 8. Config & deps

```yaml
matchers:
  arcface: true
  insightface: true        # v2
  vlm_claude: true
  pad_baseline: true       # v2
  pad_vlm: true            # v2
corpus:
  pad_bonafide: 200        # v2
  pad_attacks: 200         # v2  (~100 print / ~100 screen)
  pad_vlm_subset: 200      # v2
thresholds:
  uncertain_band_mode: relative   # v2 (Fix 1)
  uncertain_band_margin: 0.07
```

`requirements.txt` adds: `insightface`, `onnxruntime` (if not already present), `opencv-python` (attacks + frequency/texture PAD).

## 9. Build order & acceptance

1. **InsightFace adapter** — embeddings cached; appears as a second match matcher; schema still validates.
2. **Corpus rebalance + band relocation** (free Phase 1.5) — re-run match track on the balanced corpus; `by_group` shows sex + skin-tone + age; uncertain band centred on the operating threshold.
3. **Attacks** — `attacks.py` generates deterministic bona-fide + simulated attacks into the manifest.
4. **PAD adapters** — `pad_baseline` and `pad_vlm` return valid `MatchResult`s with `task_type="pad"`.
5. **PAD metrics** — APCER/BPCER/ACER + PAD ROC computed and written into the `pad` block; schema-valid.
6. **Portal** — PAD section measured, PAD findings tab, InsightFace surfaced.

**Acceptance:** the existing run command emits a schema-valid `eval_run.json` carrying both match (ArcFace + InsightFace) and PAD (`pad_baseline` + `pad_vlm`) results; APCER/BPCER/ACER present; corpus is demographically balanced with three group axes; the uncertain band is threshold-relative; the portal shows measured PAD and model-vs-model matching; **both frozen contracts unchanged**. Reproducible from the seed; the only outbound calls remain the VLM adapters in `api`/`cli` mode plus one-time model/corpus downloads.

## 10. Non-goals recap

No live capture, no real PAIs, no governance console, no contract changes. v2 is the security/measurement deepening; Phase 3 (the live flow) is the capstone after.
