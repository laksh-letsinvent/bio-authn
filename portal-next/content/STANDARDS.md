# Standards

The standards and certifications a biometric product is measured against. Each entry: what it governs, why it matters, and the tie to selfie-auth.

> Dated facts (NIST program naming, ICAO migration) are the ones most likely to age — re-check before reuse.

---

## Vocabulary

**ISO/IEC 2382-37** — the biometrics vocabulary standard. Defines the terms (verification, identification, enrolment, template, etc.) precisely enough to settle arguments. When two teams or two vendors mean different things by "verification," this is the authority.

## Presentation attack detection (liveness)

**ISO/IEC 30107** — the PAD standard family. Part 1 sets the framework and terms; **Part 3** defines how PAD is *tested* and the metrics (APCER, BPCER, ACER). This is the reference any liveness claim should cite. For a selfie-auth product, "our liveness is good" means nothing without a 30107-3 result.

**iBeta** — the NIST/NVLAP-accredited lab most associated with commercial PAD testing against ISO/IEC 30107-3. **Level 1** covers low-effort artefacts (print, screen); **Level 2** covers high-effort, custom-made instruments (masks, sophisticated replays). "iBeta Level 2 certified" is the credibility bar for banking liveness — and a question to put to every vendor: which ISO/IEC 30107-3 version, tested when, against which presentation-attack species.

## Template protection

**ISO/IEC 24745** — biometric information protection. Defines the three properties a stored template should have: **irreversibility** (can't reconstruct the biometric), **unlinkability** (can't correlate templates of the same person across systems), and **renewability** (can revoke and reissue — cancelable biometrics). The standard a template-protection claim should be held to. A vendor citing "encryption at rest" is not the same as one citing 24745 properties; the gap is exactly where model-inversion and cross-bank-replay risk lives.

## Data interchange formats

**ISO/IEC 19794 / ISO/IEC 39794** — biometric data interchange formats. 19794 is the long-standing family; **39794** is the newer, extensible replacement ICAO is migrating to for ePassports. Relevant when biometric data crosses system or vendor boundaries; less central to a single-vendor selfie-auth flow, but the standard that governs how a face record is structured for portability.

## Independent benchmarks

**NIST FRTE / FATE** — the US government's ongoing, independent face benchmarks. In August 2023 the long-running **FRVT** was split and renamed: **FRTE** (Face Recognition Technology Evaluation) covers verification/identification accuracy; **FATE** (Face Analysis Technology Evaluation) covers PAD, morph detection, image quality, and age estimation. The neutral public yardstick for "how good is good," and the authoritative source for demographic-differential (bias) data — the numbers a vendor's own marketing won't volunteer.

## Adjacent credential standard

**FIDO Alliance / FIDO2** — the body and standard behind passkeys / WebAuthn. Not a biometric standard, but the credential model selfie-auth sits beside. A passkey proves device possession (a private key signs a challenge; the biometric only unlocks the key locally and is never transmitted). Selfie-auth proves personhood. The two are complementary — passkey for daily login, biometric for step-up and recovery — and a coherent product story places both correctly rather than treating them as competitors.

---

## Quick map: standard → what it certifies

| Standard / body | Governs | The question it answers |
|---|---|---|
| ISO/IEC 2382-37 | Vocabulary | What do these terms precisely mean? |
| ISO/IEC 30107-3 | PAD testing | How spoof-resistant is the liveness, measured how? |
| iBeta L1/L2 | PAD certification | Has liveness passed independent testing, at what level? |
| ISO/IEC 24745 | Template protection | Is a stolen template actually useless? |
| ISO/IEC 19794 / 39794 | Interchange format | How is a face record structured for portability? |
| NIST FRTE / FATE | Accuracy + PAD benchmark | How accurate and how fair, independently measured? |
| FIDO2 / WebAuthn | Possession credential | Is device possession proven cryptographically? |
