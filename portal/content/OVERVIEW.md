# Face Value

Most facial recognition demos prove that a face matches a face. That's the easy part. An open model does it for free, in milliseconds, with accuracy nobody argues about anymore.

The questions worth a research project sit underneath. How good is the matcher really, and how do you prove it? What does it cost to run? Where do the new vision models actually help? And who does it fail for?

This project builds the instrument that answers those. The face matcher is the engine. The measurement around it is the work.

I'm Laksh, a product manager in identity and trust. I built Face Value to learn four things properly: how to evaluate AI, how to govern it, what it costs to run, and how to operate it. Facial biometrics is the subject. The eval is the point.

## What I built

An eval harness, and the portal you're reading.

The harness runs three approaches over the same faces and scores them on the same ruler:

- Embedding matching. ArcFace and InsightFace turn a face into 512 numbers, then compare two of them. This is how production systems actually work.
- A vision model as a second opinion. Claude looks at two photos and reasons out loud about whether they're the same person. Slow, pricey, and unusually good at explaining itself.
- Liveness (PAD). Telling a live face from a photo of one. The part attackers actually go after. I'm building this now.

## Four threads, one harness

Eval is the core. The same runs feed three more threads, so the project covers four things at once.

- Technique comparison. The same probe goes through 2 to 3 matchers and a liveness check, side by side, so you can see where each one wins.
- AI eval. FAR/FRR, ROC, threshold tuning, bias by demographic group, and a spoof bench. The core learning payload.
- Governance. Per-decision explainability, an immutable audit log, consent capture, model cards, and thresholds kept as config you change without a deploy.
- Token economy and infra. Cost per verification (including the tokens a vision model burns when it reasons), latency, and the pipeline made real instead of sketched on a slide.

## How it fits together

One probe, four stages, four threads measured across all of them.

<svg viewBox="0 0 820 200" width="100%" role="img" aria-label="Pipeline: corpus to matchers to eval to findings, with four research threads measured across every run." style="margin:8px 0;">
  <rect x="30" y="24" width="165" height="84" rx="12" fill="var(--surface-2, var(--surface))" stroke="var(--border)"/>
  <text x="112" y="60" text-anchor="middle" font-size="14" font-weight="500" fill="var(--text)" font-family="var(--font-sans, sans-serif)">Corpus</text>
  <text x="112" y="80" text-anchor="middle" font-size="10.5" fill="var(--text-2)" font-family="var(--font-mono, monospace)">900 faces</text>
  <rect x="225" y="24" width="165" height="84" rx="12" fill="var(--surface-2, var(--surface))" stroke="var(--border)"/>
  <text x="307" y="58" text-anchor="middle" font-size="14" font-weight="500" fill="var(--text)" font-family="var(--font-sans, sans-serif)">Matchers</text>
  <text x="307" y="79" text-anchor="middle" font-size="10.5" fill="var(--text-2)" font-family="var(--font-mono, monospace)">2 models · VLM · PAD</text>
  <rect x="420" y="24" width="165" height="84" rx="12" fill="var(--surface-2, var(--surface))" stroke="var(--primary)"/>
  <text x="502" y="58" text-anchor="middle" font-size="14" font-weight="500" fill="var(--text)" font-family="var(--font-sans, sans-serif)">Eval</text>
  <text x="502" y="79" text-anchor="middle" font-size="10.5" fill="var(--text-2)" font-family="var(--font-mono, monospace)">FAR · ROC · bias · cost</text>
  <rect x="615" y="24" width="165" height="84" rx="12" fill="var(--surface-2, var(--surface))" stroke="var(--border)"/>
  <text x="697" y="58" text-anchor="middle" font-size="14" font-weight="500" fill="var(--text)" font-family="var(--font-sans, sans-serif)">Findings</text>
  <text x="697" y="79" text-anchor="middle" font-size="10.5" fill="var(--text-2)" font-family="var(--font-mono, monospace)">+ governance seed</text>
  <text x="210" y="72" text-anchor="middle" font-size="18" fill="var(--text-3)">&#8594;</text>
  <text x="405" y="72" text-anchor="middle" font-size="18" fill="var(--text-3)">&#8594;</text>
  <text x="600" y="72" text-anchor="middle" font-size="18" fill="var(--text-3)">&#8594;</text>
  <text x="30" y="150" font-size="11" fill="var(--text-3)" font-family="var(--font-mono, monospace)">four threads, measured across every run</text>
  <rect x="30" y="158" width="750" height="30" rx="8" fill="none" stroke="var(--border-soft, var(--border))"/>
  <text x="405" y="177" text-anchor="middle" font-size="11" fill="var(--text-2)" font-family="var(--font-mono, monospace)">technique comparison · ai eval · governance · token economy + infra</text>
</svg>

## The experiment

A claim without a number is just a vibe, so here are the numbers.

I use 150 synthetic faces, 6 photos each. 900 images of people who don't exist, which means no privacy problem and no consent to manage. From those I build 2,250 genuine pairs (same person, different photo) and 7,500 impostor pairs (two different people). The vision model only sees a 240 pair sample, because it's slow and costs real money.

Everything runs from a fixed seed, so anyone can reproduce it. The faces come from Microsoft's DigiFace-1M.

| Element | v1 count | Why this size |
| --- | --- | --- |
| Synthetic identities | 150 | Enough for ~6 demographic buckets with usable per-group pairs |
| Images per identity | 6 | Gives 15 genuine pairs each |
| Total images | 900 | One download and label pass |
| Genuine pairs | 2,250 | Same person, different photo |
| Impostor pairs (sampled) | 7,500 | Cross-identity; bounds FAR to ~1e-3, not 1e-4 |
| VLM subset (stratified) | 240 pairs | 120 genuine / 120 impostor; bounds the VLM run (about $12 on the CLI path) |

I measure false accepts and false rejects at every threshold, the ROC curve, equal error rate, accuracy split by demographic group, whether the model's stated confidence is honest, cost per decision, and latency. The full method is in EVAL_METRICS.md. The vocabulary, about 130 terms, lives in the [Atlas](#atlas).

## Under the hood

The engine is a handful of clean parts, with more coming.

- A corpus builder that's deterministic and seeded.
- A matcher engine with a provider abstraction, so adding a model is one adapter.
- The eval harness that runs the matchers and computes the metrics.
- Cost, token, and latency accounting baked into every adapter call.
- A static dashboard, plus this portal.
- One config file: thresholds, which matchers, subset size, seed.
- A run manifest recording config, corpus version, git SHA, and timestamp. That's the governance seed.

## The stack

Python, with ONNX runtime for the face models. (Getting there took a fight with macOS; that story's in DECISIONS.md.) Claude runs through its command line mode, so the whole thing works without an API key. The portal is plain HTML and JavaScript, one charting library, no framework. The theme is a handful of CSS variables, which is why light and dark mode took about ten minutes to add.

## What it found so far

The short version: the matcher is a commodity, and every interesting decision is about what surrounds it.

What's solid, from the v1 run.

The embedding match is very good and very boring. Area under the curve of 0.999, equal error rate of 1.48%. The open model is as accurate as you'll need. Choosing the matcher is not where you earn your keep.

The vision model is a different animal. Roughly 5 cents and 10 seconds per decision, against milliseconds and nothing for the embedding match. You can't run that on every login. It pays off as a second opinion on the few cases the fast matcher is unsure about, and the economics are what decide that.

Its confidence turned out reasonably honest, but only because I checked. Expected calibration error of 0.065. A model saying it's 90% sure means nothing until you've measured whether it's right 90% of the time.

What's still cooking.

The exact "where does the second opinion earn its keep" figure is being re-measured. My first cut placed the uncertainty band in the wrong spot, the harness flagged it, and I'd rather fix it than ship it wrong. The instrument catching its own bug is the whole case for building the instrument.

The fairness numbers aren't ready. My first corpus came out 87% male, which is no basis for a bias claim. I'm rebalancing it before I'll stand behind any group-level result, because an aggregate accuracy can quietly hide a group that gets rejected three times as often.

PAD is the live build. I'm putting a cheap signal-processing detector up against the same vision model at spotting fake faces, scored on how often each one lets an attack through. Numbers soon.

## What this is not

A prototype. The faces are synthetic, the attacks are simulated, and the liveness here wouldn't survive a real fraudster. I name the limits on purpose, because a biometric story you can trust is one that's honest about where it stops. The attack-and-defense map is in THREAT_MODEL.md.

## Where to look next

The [Atlas](#atlas) is the vocabulary, written to actually be read. [Matching](#matching) shows you a real embedding and lets you watch the threshold decide. [Liveness](#liveness) explains how the attacks work. [Findings](#findings) has the charts and the caveats.

Start anywhere. If you only read one page, read the Atlas.
