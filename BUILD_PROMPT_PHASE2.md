# Build Prompt — bio-authN Phase 2 (Educational Portal)

> Paste into a coding agent after Phase 1. Read `CLAUDE.md`, `ATLAS.md`, and `DECISIONS.md` first. Phase 2 is the **public-facing educational portal** — the teaching face of the project. It reuses the v1 result schema and stays a static, shareable artifact (D7). Built so the Phase 3 live flow slots in without a rewrite.

---

## 0. What Phase 2 is

A static educational portal that teaches the concepts the harness measures. Four sections: the **Atlas** (concept reference), an interactive **matching explainer** (image → embedding → similarity → threshold), a high-level **liveness/PAD explainer**, and a **findings exhibit** (the eval results reframed for a learner). It teaches all four pillars — eval, governance, token economy, infra — using v1's own outputs as the worked example, so governance isn't dropped, it's taught.

Static HTML/CSS/vanilla JS, served like v1 (`python -m http.server`). No backend in Phase 2.

## 1. Scope

**In:** the four sections below; one locked design system; a disabled "Try it live" nav slot reserved for Phase 3.

**Out (do not build):**
- Live in-browser inference or camera capture — Phase 3. The matching explainer uses **precomputed** corpus embeddings only.
- The measured PAD eval track (simulated attacks, APCER/BPCER computed) — that's v2. Phase 2 ships a high-level *explainer* only.
- A governance ops console (audit-log browser, policy-as-config editor) — a later phase. Phase 2 teaches governance concepts using existing results.
- Any change to the two frozen contracts.

## 2. Sections

### 2.1 Atlas
Render `ATLAS.md` as a clean reading page, with `STANDARDS.md` and `COMPLIANCE.md` linked from §7/§8 pointers. Build a left sub-nav from the section headings. Use a markdown renderer (marked.js via cdnjs) or pre-render to HTML. Generous reading width (~720px), mono for defined terms. This is the stakeholder-readable surface — keep it calm and text-first.

### 2.2 Matching explainer (the hero — see the approved mockup)
Teach image → embedding → match using **precomputed** data (never live inference), with **real images and real embeddings** so the concept is visible, not described.

- Data export `portal/data/matching_examples.json`: 3 genuine + 3 impostor example pairs from the corpus + cached embeddings. Each entry: the two real image paths, the two **real** embeddings (ship full 512-d for the cosine, plus a mean-pooled ~64-cell summary for the heatmap strip), the true cosine similarity, and the label.
- Render per the mockup: two real face images, two embedding heatmap strips (real values), the cosine value, and the threshold number line with reject / uncertain-band / accept zones and a marker. Buttons switch examples and animate the marker.
- **Threshold = 0.298.** Apply the free, no-VLM part of `PHASE_1_5.md` Fix 1 inline: define the uncertain band threshold-relative (≈0.23–0.37), not the old 0.55–0.75. Needs no re-run.
- Images: DigiFace-1M faces are synthetic (no privacy issue) under R-UDA (non-commercial research). Show real faces in **both** builds with a visible DigiFace attribution + license link and no bulk download. Keep `BUILD_MODE = "public" | "local"` as a fallback switch to ID tiles for zero-risk hosting.

Enrichments (precomputed, client-side, no backend):
- **2D embedding map** — `portal/data/embedding_map.json`: precompute a 2D projection (PCA or UMAP) of the corpus embeddings; plot points coloured by identity, with a toggle to colour by demographic group. Viewers see same-identity images cluster and different identities separate — the core "what is an embedding" intuition.
- **Live threshold slider** — `portal/data/pair_scores.json`: all genuine/impostor cosine scores. A slider over the threshold recomputes FAR and FRR live in JS, updating the number line and a small confusion summary. Teaches the trade-off directly.
- **Score histogram** — from the same `pair_scores.json`: genuine vs impostor cosine distributions as two overlapping histograms with the threshold line, showing where the errors come from.

### 2.3 Liveness / PAD explainer (high-level, illustrative — real example images)
Teach what a presentation attack is and how detection works, without measuring it. Generate a small illustrative set by applying the print/screen degradation transforms to a few genuine images (`portal/data/pad_examples/`) — this does **not** pull the v2 PAD eval track forward.

- **Spot-the-attack** — show a genuine capture vs a print attack vs a screen replay and let the viewer guess, then reveal the tells (moiré, bezel, flatness / low texture). Real images, same DigiFace attribution rule as §2.2.
- **Liveness challenge animation** — a simple animated prompt (blink → turn head) illustrating why a random active challenge defeats a static photo or replay.
- Define APCER (attacks wrongly accepted) vs BPCER (genuine wrongly rejected) conceptually. Label the section: **"Illustrative — the measured PAD track is v2."** Framing from `THREAT_MODEL.md`.

### 2.4 Findings exhibit (shell now, numbers after Phase 1.5)
Reframe the v1 dashboard panels for a learner: ROC/DET, FAR-FRR vs threshold, bias by group, VLM calibration, cost & latency, and the uncertain-band disagreement. Reads the same `eval_run.json` (no schema change). Each panel gets a teaching caption ("what this shows, why it matters").

**Gate (D11):** build the shell and captions now, but do **not** display the headline disagreement numbers or the bias panel as conclusions until the `PHASE_1_5.md` re-run lands. Where a corrected number will go, show an "awaiting v1.5 re-run" placeholder. Carry the honesty banners: the FairFace-on-synthetic caveat, "trends not tight CIs," and the cli cost/latency note ($0.05/decision, ~10s/call).

## 3. Design system (locked — `portal/styles/tokens.css`)

CSS custom properties so the same tokens port into the Phase 3 React app. **Dark theme by default** — a modern security-console aesthetic matching the agreed `design/theme_preview_dark.html` preview; structure tokens so a `[data-theme="light"]` override can be added later. Display font for headings, mono for all numbers. Semantic colour encodes eval meaning — green = accept/genuine, amber = uncertain band, red = reject/impostor — never decorative.

```css
:root {
  /* dark surfaces */
  --bg:#0A0D14; --surface:#11161F; --surface-2:#161C27;
  --border:#222A37; --border-soft:rgba(255,255,255,.06);
  --text:#E7ECF3; --text-2:#9BA6B5; --text-3:#5E6A7A;
  /* accent (electric) */
  --primary:#38BDF8; --primary-2:#818CF8; --primary-glow:rgba(56,189,248,.45);
  /* semantic = eval meaning (dark-tuned) */
  --accept:#34D399; --uncertain:#FBBF24; --reject:#FB7185;
  --accept-zone:rgba(52,211,153,.26); --uncertain-zone:rgba(251,191,36,.30); --reject-zone:rgba(251,113,133,.26);
  /* type */
  --font-display:'Space Grotesk','Inter',sans-serif;
  --font-sans:'Inter',system-ui,-apple-system,sans-serif;
  --font-mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  --text-xs:12px; --text-sm:14px; --text-base:15px; --text-lg:18px;
  --text-xl:20px; --text-2xl:25px; --text-3xl:30px; --text-4xl:36px;
  --lh-body:1.6; --lh-head:1.2;
  /* space (4-based) */
  --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px;
  --space-5:24px; --space-6:32px; --space-8:48px; --space-10:64px;
  /* radius */
  --radius-sm:6px; --radius-md:10px; --radius-lg:14px; --radius-pill:999px;
  /* layout + page glow */
  --sidebar-w:236px; --reading-w:760px; --container-w:1080px;
  --page-glow:radial-gradient(1100px 420px at 50% -12%, rgba(56,189,248,.10), transparent 70%);
}

[data-theme="light"] {
  --bg:#F7F9FC; --surface:#FFFFFF; --surface-2:#F1F4F9;
  --border:#E2E8F0; --border-soft:rgba(15,23,42,.06);
  --text:#0F172A; --text-2:#475569; --text-3:#94A3B8;
  --primary:#0284C7; --primary-2:#6366F1; --primary-glow:rgba(2,132,199,.30);
  --accept:#059669; --uncertain:#D97706; --reject:#E11D48;
  --accept-zone:rgba(5,150,105,.16); --uncertain-zone:rgba(217,119,6,.18); --reject-zone:rgba(225,29,72,.14);
  --page-glow:radial-gradient(1100px 420px at 50% -12%, rgba(2,132,199,.07), transparent 70%);
}
```

**Component patterns** (`portal/styles/components.css`):
- App shell: fixed-width left sidebar (`--sidebar-w`, right border `--border`) + content column capped at `--container-w`; reading sections capped at `--reading-w`. Body carries `--page-glow` as a subtle top radial.
- Theme switcher: a toggle in the sidebar foot sets `data-theme` on `<html>` (dark default, `light` override). On first load honour the stored choice in `localStorage` (`bioauthn-theme`), else `prefers-color-scheme`. The embedding heatmap ramp swaps per mode (dark low `#16222E`→high `#7DD3FC`; light low `#E6F1FB`→high `#0284C7`) and Chart.js re-renders (see below). Demonstrated in `design/theme_preview_dark.html`.
- Brand mark: small rounded square filled `--primary`→`--primary-2` with a soft glow; `--font-display` wordmark.
- Card: `--surface` bg, `1px solid var(--border)`, `--radius-lg`, padding ~`--space-5`.
- Live-stat row: a grid of 3–4 stat cards atop data sections (the fidro-style live console) — mono uppercase label (`--text-3`, 11px, letter-spacing) over a 25px mono value; colour the value with a semantic token where it carries meaning (cost in amber, etc.).
- Headings: `--font-display`, weight 500–600. Body: `--font-sans`. Every number: `--font-mono`.
- Threshold number line: translucent semantic zones (`--*-zone`), threshold tick in `--text-2`, marker dot with a soft glow (`box-shadow:0 0 14px` of the zone colour + a `--surface` ring).
- Embedding heatmap strip: cells on a dark cyan ramp (low `#16222E` → high `#7DD3FC`).
- 2D embedding map: dark scatter — identity clusters in `--primary` / `--primary-2` / `--accept`, unfocused points in `--text-3`.
- Tabs (findings): underline-style, `--primary` on active.
- Callout: info and caveat variants with translucent fills + a left rule (no rounded corner on the single-sided border).
- Badge/pill: matcher ids and demographic groups; translucent tint + matching text colour.
- Buttons: ghost (border `--border`, hover border `--primary`); filled `--primary` for the rare CTA.
- Chart.js theme: canvas can't read CSS vars — hold both palettes in JS and re-render on theme change. Dark: accept `#34D399`, reject `#FB7185`, uncertain `#FBBF24`, primary `#38BDF8`, grid `#222A37`, text `#9BA6B5`. Light: accept `#059669`, reject `#E11D48`, uncertain `#D97706`, primary `#0284C7`, grid `#E2E8F0`, text `#475569`.

Fonts: Inter + JetBrains Mono + Space Grotesk via fonts.googleapis.com. Round every displayed number.

## 4. Phase 3 readiness

- The Phase 3 React app imports the same `tokens.css` — CSS custom properties carry over unchanged.
- Reserve a sidebar slot **"Try it live"**, rendered disabled / "coming soon" in Phase 2. It becomes the Phase 3 capture flow (camera + MediaPipe liveness + FastAPI). The matching explainer's precomputed mode is the sibling of the live mode.
- Keep Phase 2 framework-free (vanilla). Phase 3 introduces React only for the live flow and reuses these token + component patterns (number line, heatmap strip).

## 5. Stack & layout

Static HTML/CSS/vanilla JS. Single-page shell with hash-routed sections (`#atlas`, `#matching`, `#liveness`, `#findings`) sharing one nav. Libraries via cdnjs: marked.js (Atlas), Chart.js (findings). Served as static files.

```
portal/
  index.html            shell + hash router
  styles/ tokens.css  components.css
  sections/ atlas.js  matching.js  liveness.js  findings.js
  data/ matching_examples.json  embedding_map.json  pair_scores.json  pad_examples/
  assets/ (illustrations, local-only face thumbs)
```

## 6. Acceptance

- Opens offline as static files; nav routes between all four sections.
- Atlas renders from `ATLAS.md` with working sub-nav and links to STANDARDS/COMPLIANCE.
- Matching explainer shows real images + real embeddings on precomputed data, threshold at 0.298, uncertain band threshold-relative (free Fix 1 applied inline); the 2D embedding map, live threshold slider, and score histogram each render from precomputed JSON.
- PAD explainer shows real illustrative attack images with spot-the-attack + a liveness challenge animation, labelled illustrative.
- DigiFace attribution + R-UDA license link visible wherever faces appear; no bulk image download.
- Findings shell renders from `eval_run.json` with teaching captions and caveat banners; headline disagreement/bias numbers show "awaiting v1.5 re-run" until the corrected run is wired (D11).
- All colour comes from `tokens.css`; type and spacing consistent; numbers rounded.
- "Try it live" nav slot present and disabled.
- v1 result schema unchanged.
