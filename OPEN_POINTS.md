# OPEN_POINTS.md — Face Value / bio-authN

Items deferred from the v2 review (2026-06-24). None block Phase 3, but O1 blocks publishing the portal's findings as credible. Tackle before the bias and disagreement panels go public.

### O1 — Full rebuild run (fixes the bias panel and the disagreement N)
The v2 run used the existing corpus, so the bias panel renders `sex:unknown`, `age:unknown`, `skin:unknown` (labels never populated) and only 17 of 240 VLM pairs landed in the relocated uncertain band. Fix: rebuild the corpus with ITA skin-tone + ~50/50 sex stratification, FairFace-label all three axes, target the VLM subset to the band (the parked Phase 1.5 Fix 3), re-eval, regenerate portal data. Cost ~$22 in VLM calls, ~1 hour. This is what makes the bias panel real and the "VLM resolves the uncertain band" finding stand up. Until then, keep the caveat banners and don't present those two panels as conclusions.

### O2 — PAD baseline framing (no usable signal on synthetic data)
`pad_baseline` came out AUC 0.474, below chance, inverted. Cause: a frequency/texture detector assumes live faces carry more high-frequency detail than fakes, but DigiFace renders are smooth and the simulated attacks add texture and noise, so the cue runs backwards. Report it as "no usable signal on synthetic faces with synthetic attacks," not as a specific APCER, and not as a verdict on signal-processing PAD in general. A real-capture test bed would be the honest way to judge the baseline if it ever matters.

### O3 — PAD VLM result is a floor, not a ceiling
`pad_vlm` AUC 0.908 / ACER 12.5% is measured on easy print and screen simulations only. It says nothing about deepfakes or 3D masks (per THREAT_MODEL.md, the VLM catches obvious attacks and misses good ones). Label the PAD findings "obvious simulated attacks" and keep that limit visible on the portal so the 5% APCER isn't read as a real-world number.
