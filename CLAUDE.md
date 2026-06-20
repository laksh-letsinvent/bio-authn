# CLAUDE.md — bio-authN

Project memory for any agent (Claude Code / Cowork) working in this repo. Read this first, then `ATLAS.md` for domain grounding and `BUILD_PROMPT_PHASE1.md` for the v1 spec.

---

## What this is

A learning prototype: an **eval-first harness** for selfie biometric authentication. Not a login product. It runs face matchers over a synthetic corpus and measures accuracy, fairness, calibration, cost, and latency. The matching comparison is one part; the instrument around it is the point.

Owner: Laksh — Senior PM (Trust & Fraud Platform, consumer banking), 12+ years in identity/auth, moving toward AI-platform / AI-governance roles in regulated financial services.

## Why it exists (motivation — keep this in view)

Three goals, in priority order:

1. **Deep learning across four AI pillars** — eval, governance, token economy, infrastructure — applied to a biometric pipeline. The substrate (face matching, liveness, templates) is the vehicle; mastery of the four pillars is the destination.
2. **A publicly shareable artifact** that teaches these concepts to others and builds domain authority.
3. **A reusable engine** that the live demo and later prototypes (IDV with vision models) sit on top of.

Operating principle: speed of learning beats speed of shipping. A narrow v1 understood completely beats a broad v1 understood vaguely.

## Scope (agreed)

**v1 — eval harness, matching track only.** Two matchers: ArcFace (production truth) and a Claude VLM (research path). Synthetic corpus. Static dashboard renders one versioned JSON. No camera, no enrollment, no auth DB, no liveness.

**v2 — additive over the frozen contracts.** InsightFace (second embedding matcher) and the PAD/liveness track (simulated attacks + APCER/BPCER). Both are new files plus config; they touch nothing existing.

**Phase 3 — the live flow.** React + MediaPipe enrollment/step-up with ephemeral self-capture. Reuses the v1 engine and contracts unchanged. Runs local / private VM only — not a wide-open public URL.

## The two frozen contracts (do not break)

Everything stays additive only because these two shapes are fixed. Full definitions in `BUILD_PROMPT_PHASE1.md` §2.

1. **`MatcherAdapter` interface** + the `MatchResult` dataclass. Adapters return a raw score and a naive decision plus cost/latency/token fields; the harness applies the tuned threshold. The `task_type` field carries `"match"` now and `"pad"` in v2 — keep it even though v1 only writes `"match"`.
2. **The result JSON schema** (`schema_version: "1.0"`). It deliberately includes fields v1 leaves null (`pad`, `calibration` for non-LLM matchers). That is what makes v2 zero-churn. Validate every emitted file against it.

If a change would alter either contract, stop and raise it — that's a scope decision, not an implementation detail.

## Dev workflow

- **Matchers:** ArcFace/InsightFace run locally, free (cache embeddings; pairwise is just cosine).
- **VLM transports** (`vlm_mode` in config): `local` (Ollama LLaVA — free, for development), `api` (Anthropic key), `cli` (Claude Code headless — no key, reads `total_cost_usd` from JSON output). **No Anthropic API key available**, so: develop on `local`, produce publishable numbers on `cli`.
- Everything is seeded and reproducible. The only outbound network calls are the VLM in `api`/`cli` mode and one-time corpus/model downloads. Any other external call is a bug — flag it.

## How to show up (voice)

Peer-level, direct, intellectually engaged. Take positions and defend them; name what would change your mind. Name trade-offs explicitly — never hide them. Prose over bullet-point soup. When uncertain, say "I think X, but worth validating because Y" rather than hedging softly. Outputs should be usable immediately.

Avoid this vocabulary: delve, crucial, pivotal, landscape (figurative), foster, cultivate, underscore, highlight (verb), robust, seamless, holistic, leverage (verb), tapestry, garner, interplay, "Moreover/Furthermore/Additionally" as openers, "It's important to note," "In conclusion," synergy, alignment, best practice, move the needle, end-to-end. No significance inflation — replace "this is pivotal" with a specific number or consequence.

## Domain guardrails (precision matters — see ATLAS.md)

- **AuthN ≠ AuthZ.** Who you are vs what you may do.
- **FAR/FMR ≠ APCER.** Impostor-accepted (matching) vs attack-accepted-as-live (liveness).
- **Capture integrity ≠ template privacy.** Signed capture stops injection; it says nothing about how the template is stored.
- **"ZKB integration" ≠ ZKB.** Without device-SDK enrollment generating the mask, it's plaintext server-side matching.
- **Aggregate accuracy ≠ fair accuracy.** A strong overall FRR can hide a group rejected several times more often.
- **VLM confidence ≠ VLM accuracy.** Not until calibration (ECE) is measured.
- The VLM in this project is a *second-opinion reasoner* for the uncertain band, never the primary gate.

## Document map

- `ATLAS.md` — domain + tech glossary (~130 terms). Later becomes the prototype's Atlas page.
- `CONTEXT.md` — original prototype thinking. Superseded on scope by the build prompt.
- `BUILD_PROMPT_PHASE1.md` — the agreed, buildable v1 spec. Hand to a coding agent.
- `DECISIONS.md` — what was decided and why (read before re-opening a settled question).
- `THREAT_MODEL.md` — biometric attack→defense taxonomy.
- `EVAL_METRICS.md` — the measurement discipline, with formulas and worked examples.

When the build prompt and CONTEXT.md disagree, the build prompt wins.
