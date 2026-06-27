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
- Liveness (PAD). Telling a live face from a photo of one. The part attackers actually go after.

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

I measure false accepts and false rejects at every threshold, the ROC curve, equal error rate, accuracy split by demographic group, whether the model's stated confidence is honest, cost per decision, and latency. The vocabulary, about 130 terms, lives in the [Atlas](#atlas).

### The matchers

Five run over the same faces, scored on one ruler. ArcFace and InsightFace are open embedding models, ONNX, free, local. Claude is the vision model, used two ways: a second opinion on uncertain matches, and a passive liveness check. A frequency-and-texture detector is the cheap liveness baseline. Same interface for all five, so swapping one in is a single adapter.

### Keeping the vision model cheap

Every Claude call costs about 5 cents and 10 seconds, so it never runs on everything. It sees a small stratified sample. For the uncertain-band study I reused the calls I'd already paid for and added only the few that landed in the band, so the whole re-run cost a couple of dollars. The cost discipline is the finding, not an overhead.

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

Python, with ONNX runtime for the face models. Claude runs through its command line mode, so the whole thing works without an API key. The portal is a Next.js app with Tailwind and shadcn, dark and light, built to read well on a phone.

## What it found

The matcher is a commodity, and every interesting decision is about what surrounds it.

The embedding match is very good and very boring. Both open models scored 0.999 AUC, with equal error rates under 2%. Choosing the matcher is not where you earn your keep.

The vision model is the interesting case. About 5 cents and 10 seconds per check, against milliseconds and nothing for the embedding match. You can't run it on every login. It earns its place as a second opinion on the cases the fast model is unsure about, and there it called 54 of 62 right. It missed 8, so it sits as a backup check rather than the main gate. Its stated confidence held up reasonably once measured (calibration error 0.065), which you only learn by checking.

Liveness showed the same split. The vision model told live faces from simulated print and screen attacks reasonably well (AUC 0.91). The cheap frequency detector had no usable signal on synthetic faces. Its assumption runs backwards when the live faces are smooth CGI and the fakes have texture added, which is itself a real finding about where signal processing breaks.

And the honest gap. I tried to measure demographic bias and couldn't. Labeling synthetic faces for skin tone with an off-the-shelf classifier came out degenerate, so I don't make a fairness claim here. Measuring fairness honestly is harder than measuring accuracy.

These are synthetic faces and simulated attacks, so read the liveness numbers as a floor. The real world will be harder.

## What this is not

A prototype. The faces are synthetic, the attacks are simulated, and the liveness here wouldn't survive a real fraudster. I name the limits on purpose, because a biometric story you can trust is one that's honest about where it stops.

## Where to look next

The [Atlas](#atlas) is the vocabulary, written to actually be read. [Matching](#matching) shows you a real embedding and lets you watch the threshold decide. [Liveness](#liveness) explains how the attacks work. [Findings](#findings) has the charts and the caveats.

Start anywhere. If you only read one page, read the Atlas.
