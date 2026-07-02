# CLAUDE.md — bio-authN

Project memory for any agent (Claude Code / Cowork) working in this repo. Read this first, then `ATLAS.md` for domain grounding and `BUILD_PROMPT_PHASE1.MD` for the v1 spec.

---

## What this is

Two eval-first harnesses in one repo, published as two separate portals:

| Portal | Brand | Domain | Scope |
|--------|-------|--------|-------|
| **Face Value** | `face-value` | bio-authn.letsinvent.co.uk | Selfie biometric auth — face matching, PAD, fairness |
| **Hard Copy** | `hard-copy` | hardcopy.letsinvent.co.uk | Document IDV — classify, extract, authenticate, face-match |

Both are learning prototypes, not products. The eval instrument is the point; the biometric substrate is the vehicle.

Owner: Laksh — Senior PM (Trust & Fraud Platform, consumer banking), 12+ years in identity/auth, moving toward AI-platform / AI-governance roles in regulated financial services.

## Why it exists (motivation — keep this in view)

Three goals, in priority order:

1. **Deep learning across four AI pillars** — eval, governance, token economy, infrastructure — applied to biometric pipelines. The substrate (face matching, liveness, document verification) is the vehicle; mastery of the four pillars is the destination.
2. **A publicly shareable artifact** that teaches these concepts to others and builds domain authority.
3. **A reusable engine** that the live demo and later prototypes sit on top of.

Operating principle: speed of learning beats speed of shipping. A narrow v1 understood completely beats a broad v1 understood vaguely.

---

## Face Value scope (agreed)

**v1 — eval harness, matching track only.** Two matchers: ArcFace (production truth) and a Claude VLM (research path). Synthetic corpus. Static dashboard renders one versioned JSON. No camera, no enrollment, no auth DB, no liveness.

**v2 — additive over the frozen contracts.** InsightFace (second embedding matcher) and the PAD/liveness track (simulated attacks + APCER/BPCER). Both are new files plus config; they touch nothing existing.

**Phase 3 — the live flow.** React + MediaPipe enrollment/step-up with ephemeral self-capture. Reuses the v1 engine and contracts unchanged. Runs local / private VM only.

## Hard Copy scope (IDV track)

**v1 — four-stage pipeline, synthetic corpus (MIDV-2020 + SIDTD).** Tasks: classify (doc type + country), extract (6 fields, VLM vs OCR baseline), authenticate (ELA + VLM doc-auth), face-match (ArcFace cross-domain: selfie vs printed card portrait). Results in `results/idv_run.json` (`schema_version: "idv-1.0"`).

**v1.5 — HuggingFace external validation.** `idv/hf_validation.py` streams 150 docs from `saberzl/SID_Set` (CC-BY-4.0, synthetic, genuine/tampered binary labels). ELA on all 150, VLM on 30 (15+15 balanced). Results in `results/idv_run_v1_5.json` (`schema_version: "idv-1.5"`). Key finding: VLM AUC 1.000 → 0.902, ACER 0% → 13.3% (partial over-fit to one synthetic generator).

**IDV portals pages:** The Experiment (prose overview from `OVERVIEW_IDV.md`) · Atlas · IDV in Action (precomputed pipeline walkthrough) · Try It · Results (with "Generalization ↗" tab for v1.5 comparison).

### Key IDV numbers (v1)
- Extraction VLM field accuracy: 98.3% (6 fields, 10 docs)
- Auth VLM AUC: 1.000, ACER: 0.0% (20 docs, synthetic corpus)
- Auth ELA AUC: 0.5 (useless — no compression artefact signal on synthetic images)
- Face match: ArcFace cross-domain AUC ≈ 0.50 (genuine and impostor score distributions fully overlap at doc threshold 0.252; cross-domain gap defeats the matcher)

---

## The two frozen contracts (Face Value — do not break)

Everything stays additive only because these two shapes are fixed. Full definitions in `BUILD_PROMPT_PHASE1.md` §2.

1. **`MatcherAdapter` interface** + the `MatchResult` dataclass. Adapters return a raw score and a naive decision plus cost/latency/token fields; the harness applies the tuned threshold. The `task_type` field carries `"match"` now and `"pad"` in v2 — keep it even though v1 only writes `"match"`.
2. **The result JSON schema** (`schema_version: "1.0"`). It deliberately includes fields v1 leaves null (`pad`, `calibration` for non-LLM matchers). That is what makes v2 zero-churn. Validate every emitted file against it.

The IDV schemas (`idv-1.0`, `idv-1.5`) are separate and defined in `idv/schema_idv.py`. They are NOT the same as the Face Value schema.

If a change would alter either contract, stop and raise it — that's a scope decision, not an implementation detail.

---

## Portal architecture

Single Next.js 16 app in `portal-next/`. Static export (`output: "export"`) → `out/` directory served by nginx.

`NEXT_PUBLIC_BRAND` build-time env var selects the brand:
- `face-value` (default) → Face Value nav, teal/cyan accent
- `hard-copy` → Hard Copy nav, burgundy accent (`#C24A66`)

Both brands live in the same build; two nginx vhosts point at the same `out/` directory. The `/hardcopy/*` routes carry the Hard Copy content; Face Value routes live at root.

### Deployment
- VM: Linux, nginx, certbot TLS
- Static files: `/var/www/bio-authn/portal-next/out/`
- Nginx configs: `deploy/nginx-bio-authn.conf` (Face Value) · `deploy/nginx-hardcopy.conf` (Hard Copy)
- Build locally: `npm run build` (produces `out/`) then rsync to VM
- Hard Copy needs a separate nginx vhost for `hardcopy.letsinvent.co.uk` pointing at the same `out/` directory, plus `location = / { return 302 /hardcopy/; }`

---

## Dev workflow

- **Matchers:** ArcFace/InsightFace run locally, free (cache embeddings; pairwise is just cosine).
- **VLM transports** (`vlm_mode` in config): `local` (Ollama LLaVA — free, for development), `api` (Anthropic key), `cli` (Claude Code headless — no key, reads `total_cost_usd` from JSON output). **No Anthropic API key available**, so: develop on `local`, produce publishable numbers on `cli`.
- IDV corpus lives in `idv/data/` (not committed — large binary images). Run `idv/build_idv_corpus.py` to regenerate.
- Everything is seeded and reproducible. The only outbound network calls are the VLM in `api`/`cli` mode and one-time corpus/model downloads. Any other external call is a bug — flag it.

---

## How to show up (voice)

Peer-level, direct, intellectually engaged. Take positions and defend them; name what would change your mind. Name trade-offs explicitly — never hide them. Prose over bullet-point soup. When uncertain, say "I think X, but worth validating because Y" rather than hedging softly. Outputs should be usable immediately.

Avoid this vocabulary: delve, crucial, pivotal, landscape (figurative), foster, cultivate, underscore, highlight (verb), robust, seamless, holistic, leverage (verb), tapestry, garner, interplay, "Moreover/Furthermore/Additionally" as openers, "It's important to note," "In conclusion," synergy, alignment, best practice, move the needle, end-to-end. No significance inflation — replace "this is pivotal" with a specific number or consequence.

---

## Domain guardrails (precision matters — see ATLAS.md)

- **AuthN ≠ AuthZ.** Who you are vs what you may do.
- **FAR/FMR ≠ APCER.** Impostor-accepted (matching) vs attack-accepted-as-live (liveness).
- **Capture integrity ≠ template privacy.** Signed capture stops injection; it says nothing about how the template is stored.
- **"ZKB integration" ≠ ZKB.** Without device-SDK enrollment generating the mask, it's plaintext server-side matching.
- **Aggregate accuracy ≠ fair accuracy.** A strong overall FRR can hide a group rejected several times more often.
- **VLM confidence ≠ VLM accuracy.** Not until calibration (ECE) is measured.
- The VLM in this project is a *second-opinion reasoner* for the uncertain band, never the primary gate.

---

## Document map

**Root-level:**
- `ATLAS.md` — Face Value domain + tech glossary (~130 terms).
- `ATLAS_IDV.md` — Hard Copy / IDV domain glossary.
- `OVERVIEW_IDV.md` — narrative overview of the IDV eval, rendered on the Hard Copy "Experiment" page.
- `CONTEXT.md` — original prototype thinking. Superseded on scope by the build prompt.
- `BUILD_PROMPT_PHASE1.md` — the agreed, buildable Face Value v1 spec.
- `DECISIONS.md` — what was decided and why (read before re-opening a settled question).
- `THREAT_MODEL.md` — biometric attack→defense taxonomy.
- `EVAL_METRICS.md` — the measurement discipline, with formulas and worked examples.
- `STANDARDS.md` — ISO/IEC, iBeta, NIST FRTE/FATE, FIDO2.
- `COMPLIANCE.md` — UK/EU regulation: GDPR, PSD2/SCA, FCA, DIATF/DVS, eIDAS2.

**IDV-specific:**
- `idv/` — eval engine for Hard Copy (adapters, corpus builder, HF validation script, manifest).
- `results/idv_run.json` — v1 results (schema `idv-1.0`).
- `results/idv_run_v1_5.json` — v1.5 HuggingFace generalization results (schema `idv-1.5`).

When the build prompt and CONTEXT.md disagree, the build prompt wins.
