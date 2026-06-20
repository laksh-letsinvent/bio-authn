# EVAL_METRICS.md — bio-authN

The measurement discipline, deeper than the glossary: definitions with formulas, the statistics that bound what you can claim, and worked examples on this project's corpus. Eval is the v1 spine, so this is the reference the harness and dashboard are built against.

---

## The decision model

Every matcher produces a **score** (similarity for face matching, liveness score for PAD; higher = more genuine/live). A **threshold** turns the score into accept/reject. Every metric below is a property of the score distributions of two populations — *genuine* vs *impostor* pairs (matching), or *bona-fide* vs *attack* samples (PAD) — read at one or many thresholds.

The adapter never picks the threshold. It returns the raw score; the harness sweeps thresholds and chooses the operating point. This separation is why the same scores yield the whole ROC curve, not a single yes/no.

## Matching accuracy

**FAR / FMR (False Accept / Match Rate)** — impostor pairs wrongly accepted ÷ total impostor pairs, at threshold t. The security failure.

**FRR / FNMR (False Reject / Non-Match Rate)** — genuine pairs wrongly rejected ÷ total genuine pairs, at threshold t. The usability failure.

**The trade-off.** Raise the threshold to cut impostors (lower FAR) and you reject more genuine users (higher FRR). They move in opposite directions; there is no setting that minimises both. Choosing where on the curve to sit is the actual decision — name it, don't bury it.

**Threshold sweep → curves.** Compute (FAR, FRR) across all thresholds:

- **ROC** — true-accept rate (1−FRR) vs FAR. Shows whole-matcher behaviour.
- **DET** — FRR vs FAR on a normal-deviate scale; spreads out the low-error region where banking actually operates. Preferred for biometrics.
- **AUC** — single scalar summarising ROC. Good for ranking matchers, blind to *where* you operate.
- **EER (Equal Error Rate)** — the threshold where FAR = FRR. A clean comparison number, but rarely the operating point — banks run far tighter on security than EER.
- **TAR @ FAR** — true-accept rate at a fixed FAR (e.g. TAR @ FAR=1e-3). The honest way to state accuracy: "at one-in-a-thousand false accepts, we admit 98.x% of genuine users." This is how NIST and vendors report.

**Operating threshold** — chosen at a target FAR (project default 1e-2). The harness records it; all per-group numbers are read there.

## The statistics — what the corpus lets you claim

This is where most biometric demos overclaim. The corpus (D5: 150×6 → 2,250 genuine, 7,500 impostor, 240 VLM subset) bounds what's measurable.

**Minimum measurable rate = 1/N.** With 7,500 impostor pairs the smallest non-zero FAR you can even observe is 1/7,500 ≈ 1.3×10⁻⁴.

**Rule of three.** If you observe *zero* events in N trials, the 95% upper bound on the true rate is ≈ 3/N. So with 7,500 impostor pairs and zero false accepts, you can credibly say FAR ≤ 3/7,500 ≈ 4×10⁻⁴. To support a claim at 1×10⁻⁴ you'd need ~30,000+ pairs. **This is why v1 bounds FAR to ~1e-3, not 1e-4** — and why production-tight FAR isn't a v1 goal.

**Confidence interval on a rate.** Standard error of a proportion p over n samples ≈ √(p(1−p)/n); the 95% CI is ≈ ±1.96·SE. Worked example for a demographic bucket: ~25 identities/bucket → ~375 genuine pairs. If a group's true FRR is 2%, SE = √(0.02·0.98/375) ≈ 0.0072, so the 95% CI is ≈ ±1.4%. A measured 2% could really be anywhere from ~0.6% to ~3.4%. **Conclusion: the bias panel shows trends, not certified small differences.** Tight CIs need 300+ identities (a v1.5 knob).

**FRR needs fewer samples than FAR.** FRR sits at the 1–5% level, FAR at 0.1% or below. Measuring a 2% rate takes far fewer samples than a 0.1% rate, so 2,250 genuine pairs resolve FRR comfortably while the impostor side is the binding constraint.

## Fairness

**Demographic differential** — FRR (and FAR) computed per demographic bucket at the operating threshold. The metric aggregates hide.

**Disparity ratio** — worst-group FRR ÷ best-group FRR. One number for "how unfair." Read it alongside the CI caveat above — a large ratio on small buckets still means "investigate," not "proven."

## Calibration (VLM)

A model's stated confidence is only trustworthy if it matches reality: of all the times it says "0.9 confident," it should be right ~90% of the time. VLMs are often **confidently wrong** — well-calibrated confidence can't be assumed, it must be measured.

**Method.** Bin predictions by stated confidence; for each bin compare mean confidence to empirical accuracy. Plot the reliability curve (perfect calibration is the diagonal).

**ECE (Expected Calibration Error)** — the sample-weighted average gap between confidence and accuracy across bins. One scalar; lower is better. This is why raw VLM confidence is never a gate until ECE is known.

## PAD metrics (v2)

For the liveness track:

- **APCER** — attacks accepted as live ÷ attacks. The security number.
- **BPCER** — bona-fide rejected as attacks ÷ bona-fide. The friction number.
- **ACER** — (APCER + BPCER)/2. Single headline figure (deprecated in newer revisions but still quoted).

Same threshold trade-off as FAR/FRR, on the liveness score.

## Cost & latency (token economy + infra)

Measured per matcher, per decision:

- **Tokens in / out** — input (image, scaled by resolution) and output (reasoning) tokens for VLM calls. Zero for embedding matchers.
- **usd_per_decision** — total spend ÷ calls. The number that decides whether a VLM second opinion is affordable at scale.
- **Latency p50 / p95** — median and tail per matcher. ArcFace is sub-second local; the VLM is the expensive line item. Note: latency isn't comparable across `local`/`api`/`cli` transports — each measures a different thing (your hardware vs Anthropic infra vs agent spin-up).

## The headline analysis — uncertain-band disagreement

The finding the whole design is built to produce. ArcFace is fast, free, deterministic, and reliable *except* in an uncertain score band (default cosine 0.55–0.75) where genuine and impostor distributions overlap. Within that band, count the pairs and measure how often the VLM calls them correctly.

If the VLM adds accuracy in the band, the defensible architecture is clear: ArcFace decides the easy cases for free; route only the ~uncertain fraction to a costlier VLM second opinion. That ties eval (where is the matcher weak), token economy (what does the second opinion cost), and governance (explainable adjudication of hard cases) into one result. This is where a vision LLM earns its tokens in a biometric pipeline — or, if the data says it doesn't, that's the finding.

## Reading the dashboard

Overview (summary + the disagreement headline) → Matching (ROC/DET, FAR-FRR-vs-threshold) → Bias (per-group bars + disparity ratio, with the CI caveat banner) → Calibration (reliability curve + ECE) → Cost & Latency (tokens, $/decision, p50/p95) → Disagreement (uncertain-band detail). Every panel reads from one schema-validated `eval_run.json`.
