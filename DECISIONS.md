# DECISIONS.md — bio-authN

A running log of the calls made and why. Read this before re-opening a settled question. ADR-lite: each entry states the decision, the reasoning, the trade-off accepted, and what would reverse it. Dates are when the call was made.

---

### D1 — Eval-first, not a face-matching demo
**2026-06-20.** The product is the eval/governance/economy/infra harness; the face matcher is the vehicle. A face matcher proves nothing new; an eval-and-cost instrument around biometric AI is rarer and maps to the owner's AI-governance positioning.
*Trade-off:* less visible "wow" early (no live camera in v1) in exchange for depth where the learning is.
*Would reverse if:* the goal shifted from learning the four pillars to shipping a usable auth flow fast.

### D2 — v1 = two matchers, matching track only
**2026-06-20.** ArcFace (production truth) + Claude VLM (research path). This minimal set exercises every harness mechanic: threshold sweep, ROC/DET, bias, calibration, cost/token accounting, uncertain-band disagreement.
*Trade-off:* no model-vs-model or liveness signal in v1.
*Would reverse if:* a specific finding required a third matcher to be credible in v1.

### D3 — Defer PAD track and InsightFace to v2
**2026-06-20.** Both are pure additions over the frozen contracts (D6). PAD slots in via `task_type="pad"`; InsightFace is one adapter + a config flag. Deferring sharpens v1 and avoids overwhelm; nothing is lost, only sequenced.
*Trade-off:* v1 can't measure spoofing (the more interesting security half) or compare face models.
*Would reverse if:* the PAD story were needed for the first public showcase.

### D4 — Data: synthetic corpus + ephemeral self-capture
**2026-06-20.** Eval/bias run on a downloaded synthetic identity set (lead candidate DigiFace-1M — verify license before use); the future live flow uses the visitor's own capture, ephemerally, never stored. No real PII at rest.
*Trade-off:* synthetic faces + FairFace labelling make the bias panel method-demonstrating, not audit-grade.
*Would reverse if:* a licensed, demographically labelled real dataset became available and the ethics/GDPR cleared.

### D5 — Corpus sizing: 150 identities × 6 images
**2026-06-20.** 900 images → 2,250 genuine pairs (all within-identity), 7,500 sampled impostor pairs, 240-pair stratified VLM subset. Impostor count bounds measurable FAR to ~1e-3 (rule of three), not 1e-4. ~25 identities/bucket gives trend-level bias signal, not tight CIs.
*Trade-off:* can't claim production-tight FAR (1e-4) or certify small demographic gaps.
*Would reverse if:* publishing needed CIs — push identities to 300+ (a v1.5 knob).

### D6 — Two frozen contracts
**2026-06-20.** The `MatcherAdapter`/`MatchResult` interface and the result JSON schema are fixed, including fields v1 leaves unused (`task_type`, `pad`, `calibration`). This is the mechanism that keeps every later addition zero-churn.
*Trade-off:* a little unused surface in v1.
*Would reverse if:* never lightly — a contract change is a scope decision, raised explicitly.

### D7 — Static dashboard is the shareable artifact; live flow stays private
**2026-06-20.** The harness emits JSON; a single-file HTML dashboard renders it. Static, offline, safe to share anywhere. The live enroll/step-up flow is backend-bound and runs local / private VM only.
*Trade-off:* the public-facing piece is a results explorer, not a try-it-yourself auth demo.
*Would reverse if:* a hosted interactive demo became worth the server cost, key management, and abuse surface.

### D8 — VLM transports: local / api / cli; cli is the no-key route
**2026-06-20.** One adapter contract, three transports. `local` (Ollama LLaVA) for free development; `api` (Anthropic SDK) if a key exists; `cli` (Claude Code headless, `claude -p --output-format json`) for frontier-quality runs with no API key, reading `total_cost_usd` from the output so cost accounting survives. Owner has no API key → develop on `local`, publish on `cli`.
*Trade-off:* `cli` carries per-call agent spin-up latency and slight agent overhead vs a raw model call.
*Would reverse if:* an API key became available (cleaner usage accounting, lower latency).

### D9 — Hosting: local + private VM
**2026-06-20.** Not a wide-open public URL. Removes GDPR/abuse pressure and lets the static dashboard be the public face while the live flow stays controlled.
*Trade-off:* lower reach for the interactive piece.
*Would reverse if:* the showcase goal demanded broad public hands-on access.

### D10 — Corpus source: DigiFace-1M (10K×72 partition), minimal acquisition
**2026-06-20.** Primary corpus is DigiFace-1M's 10K-identity × 72-image partition — rendered with balanced demographic attributes, which the bias panel needs; generative sets (DCFace/SynFace) carry training-data skew that would make the bias audit circular. Acquire only the smallest archive holding ≥150 identities, or stream from a HF mirror and stop at 150×6 — never the full multi-GB set. Public dashboard shows scores + pair IDs only, no face thumbnails (sidesteps redistribution licensing; thumbnails stay in the local build).
*Trade-off:* DigiFace looks CGI — weaker for a photorealistic live-demo feel; acceptable since v1 is the eval harness, not the live flow.
*Would reverse if:* DigiFace license/download proves painful → fall back to DCFace, then SynFace, noting added generative-corpus skew in the manifest.
