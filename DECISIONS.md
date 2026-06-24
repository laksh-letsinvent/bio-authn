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

### D11 — Park v1 corrections; publish findings only after the re-run
**2026-06-22.** First real eval run surfaced three measurement issues (see `PHASE_1_5.md`): the uncertain band was hardcoded at 0.55–0.75 but the tuned operating threshold is 0.298, so the headline disagreement finding was measured in the confidently-correct zone, not the overlap; the corpus is 87% male with only a sex axis; the VLM subset doesn't sample the real band. Fixes are config/corpus/metric-definition only — both frozen contracts hold. Parked until token budget allows the ~$12, ~40-min VLM re-run. Cost/latency numbers ($0.05/decision, ~10s/call on CLI) are kept as findings.
*Trade-off:* v1 findings can't be published or used as the portal's teaching exhibit until the re-run lands.
*Would reverse if:* nothing — this is a correctness gate, not an open question.

### D12 — Phase 2 = educational portal (not the governance ops console)
**2026-06-22.** Phase 2 is redefined as a static, shareable educational portal: Atlas + interactive matching explainer (precomputed embeddings) + high-level PAD explainer + a findings exhibit. It teaches all four pillars using v1's own outputs, so governance is taught rather than dropped. Locked design system in `tokens.css` (CSS custom properties, semantic colour = accept/uncertain/reject), reused by the Phase 3 React app. Spec in `BUILD_PROMPT_PHASE2.md`.
*Trade-off:* defers the deep governance machinery (audit-log browser, policy-as-config console) to a later phase; matching explainer uses precomputed data, not live inference.
*Would reverse if:* the priority shifted from teaching/authority to building the governance operations surface — then a governance-console phase would precede the portal.

### D13 — Real images + embeddings in the portal; four enrichments; Phase 2 needs no expensive Phase 1.5
**2026-06-22.** Matching and PAD explainers use real example images and real precomputed embeddings (not ID tiles) so viewers see the concept in action. DigiFace-1M is R-UDA licensed (non-commercial research, no sale, attribution, bind redistributees); a small, attributed, illustrative set in a non-commercial educational portal is consistent with that — so the public build may show real synthetic faces with a visible DigiFace credit + license link and no bulk download. (Read of R-UDA, not legal advice; if monetised or zero-risk needed, swap public faces for self-generated.) Relaxes D10/D11's tiles-only-public caution. Four precomputed enrichments added: 2D embedding map, live threshold slider (FAR/FRR trade-off), genuine/impostor score histogram, PAD spot-the-attack + liveness animation. Phase 2 (Atlas, matching, PAD explainers) has no dependency on the parked Phase 1.5 — the only inline step is the free, no-VLM relocation of the uncertain-band definition to threshold-relative; the $12 VLM re-run stays parked until the findings exhibit is wired.
*Trade-off:* a strict R-UDA reading could disfavour hosting images; mitigated by small-N + attribution + non-commercial, with self-generated faces as the zero-risk fallback.
*Would reverse if:* the portal is monetised → switch public face examples to self-generated.

### D14 — Portal theme: dark security-console (replaces the light v1 theme)
**2026-06-22.** The first Phase 2 build shipped a light theme that read dated. Replaced with a dark, modern security-console aesthetic (reference: fidro.io/live genre, not a brand clone) — near-black canvas + faint top glow, hairline surfaces, electric sky/indigo accent, mono numerics, glowing semantic green/amber/red, a live-stat row using real v1 numbers, Space Grotesk display + Inter body. Locked in `BUILD_PROMPT_PHASE2.md` §3 and previewed in `design/theme_preview_dark.html`. The change is a `tokens.css` swap plus dark-specific component touches (glows, translucent zones), not a rebuild — the token-based design system made the reskin cheap, which was the point of tokenising it.
*Trade-off:* dark default, with a persisted light/dark switcher (honours `prefers-color-scheme` on first load); light mode is a crisp modern palette, not the dated v1 one.
*Would reverse if:* the accent/colour direction misses — a one-token change (`--primary`) reskins either mode.

### D15 — Next build is v2 (PAD + InsightFace), not Phase 3
**2026-06-23.** Chose the PAD/liveness eval track + InsightFace over the live camera flow. PAD is the security half (matching is solved, liveness is attacked), teaches a new metric family (APCER/BPCER/ACER), is additive over the frozen contracts, and needs no tokens or camera — so it upgrades the portal's PAD section from illustrative to measured. The free Phase 1.5 fixes (band relocation + corpus rebalance) fold in while the corpus/eval code is open; the ~$12 VLM matching re-run stays parked (optionally amortised against PAD VLM calls). Spec in `BUILD_PROMPT_V2.md`. Phase 3 (live flow) is the capstone after. Portal name still open (leaning "Face Value").
*Trade-off:* defers the tangible demoable artifact (live selfie flow) in favour of deeper eval learning.
*Would reverse if:* the immediate goal became a thing to show people rather than to learn — then Phase 3 jumps the queue.
