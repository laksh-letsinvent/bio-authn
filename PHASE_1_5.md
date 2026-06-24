# PHASE_1_5.md — v1 corrections (parked, run when tokens are available)

> Found by reading the first real eval run (2026-06-22). The harness works; these are measurement-correctness fixes, not rebuilds. **No change to either frozen contract** — config, corpus selection, and one metric definition only. Run before the v1 findings are published or used as the Phase 2 teaching exhibit, because the headline number is currently measured in the wrong place.

## Context from the run that triggered this

- ArcFace operating threshold came out at **0.298** (cosine similarity, tuned to FAR≈1%). Genuine median 0.58, impostor median 0.10.
- The hardcoded uncertain band **0.55–0.75 holds 1,228 genuine pairs and 0 impostors** — it's the confidently-correct zone, not the ambiguous one. Real overlap is ~**0.23–0.37** (120 genuine + 443 impostors; 45 false rejects, 70 false accepts).
- Corpus is **87% male** (8,470 male vs 1,280 female pairs); only sex came through as a group — no skin-tone/age buckets.
- CLI VLM transport: **$0.050/decision** ($12.08 / 240) and **p50 9.7s, p95 13.3s** latency. These are findings to keep, not bugs to fix.

## Fix 1 — Uncertain band must be threshold-relative

Stop hardcoding `[0.55, 0.75]`. Define the band around the operating threshold where genuine and impostor distributions actually overlap. Config: replace the fixed band with `uncertain_band_mode: relative` and `uncertain_band_margin: 0.07` → band = `[op_thr − margin, op_thr + margin]` (i.e. ~0.23–0.37 for this run). Keep the literal `[lo, hi]` in the emitted JSON so the schema is unchanged; only how it's computed changes.
*Recompute over existing `pairs_raw.csv` is free* — but see Fix 3, because few VLM-subset pairs currently fall in the real band.

## Fix 2 — Rebalance the corpus and surface all demographic axes

Re-select 150 identities stratified to balance **sex** and to populate **skin-tone and age** buckets from the FairFace labels. `by_group` must emit every demographic axis (sex + skin-tone + age), not sex alone, with roughly balanced `n_pairs` per group. Re-run ArcFace only — it's free and fast. A bias panel on an 87%-male, single-axis corpus is the first thing a skeptic dismantles; this is what makes the fairness pillar credible.

## Fix 3 — Re-target the VLM subset to the overlap zone, then re-run

The 240-pair VLM subset was stratified by genuine/impostor + demographics, not by ArcFace uncertainty, so it barely samples the real band. Re-select the subset to **oversample the overlap zone** (the relocated band), keeping genuine/impostor and demographic balance within it. Re-run those ~240 VLM calls. **Cost ≈ $12, time ≈ 40 min on the CLI transport** — budget for it. This is the run that actually answers "does a VLM second opinion earn its tokens on the hard cases."

## Fix 4 — Record the economics (no code change)

Keep the cost/latency numbers as headline findings. Optional: add a config note that `cli` runs ~$0.05/call and ~10s/call, so any run materially larger than 240 pairs should use `api` if a key becomes available.

## Also update the docs

`EVAL_METRICS.md` currently describes the uncertain band as the hardcoded 0.55–0.75 region — rewrite that section to define it threshold-relative (Fix 1) so the teaching material matches the corrected method.

## Acceptance

- Uncertain band is centred on the operating threshold and contains **both** genuine and impostor pairs.
- `by_group` reports sex + skin-tone + age with roughly balanced `n_pairs`; disparity ratios computed per axis.
- Disagreement metric is measured over VLM pairs that fall **inside** the relocated band.
- Both frozen contracts unchanged; schema still validates.
