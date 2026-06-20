# THREAT_MODEL.md — bio-authN

Domain depth the glossary doesn't carry: how biometric systems are actually attacked, what defends each attack, and where each sits in this project's scope. Matching two faces is solved; defending the capture and the stored template is where systems fail. This is the map for the v2 PAD work and the governance story.

---

## Attacker goals

Three things an attacker wants from a biometric auth system:

- **Impersonate** — be accepted as a specific legitimate user (account takeover).
- **Evade** — avoid being recognised as themselves (watchlist dodging; less relevant to 1:1 auth).
- **Harvest** — steal biometric data to replay elsewhere or reconstruct a face. Biometrics are permanent, so a harvested template is a lifelong liability, unlike a resettable password.

## Attack surface by stage

A selfie-auth pipeline has four stages, each with its own attacks:

1. **Capture** — the camera and the moment of image acquisition.
2. **Transport** — image/template moving from device to server.
3. **Template store** — where the reference biometric lives.
4. **Matching** — the comparison and decision.

## Attack → defense map

| Attack | Stage | What it is | Primary defense | Standard | In bio-authN |
|---|---|---|---|---|---|
| **Print attack** | Capture | Hold a printed photo to the camera | Active liveness (challenge-response), texture/passive PAD | ISO/IEC 30107-3 | v2 PAD (simulated) |
| **Screen replay** | Capture | Replay a photo/video on a screen | Active liveness, moiré/reflection detection | ISO/IEC 30107-3 | v2 PAD (simulated) |
| **Video replay** | Capture | Replay legitimate captured video | Randomised active challenge, freshness/nonce | ISO/IEC 30107-3 | Partial (challenge logic, Phase 3) |
| **3D mask** | Capture | Sculpted/printed mask with real depth | Depth/3D liveness, specialist vendor | ISO/IEC 30107-3 L2 | Out of scope (noted) |
| **Deepfake / face swap** | Capture | AI-generated or swapped video of the target | Advanced liveness, injection defense, deepfake detectors | evolving | Out of scope (named as the live threat) |
| **Injection attack** | Capture/Transport | Bypass the camera, feed a synthetic stream (virtual camera, SDK tamper) | Capture integrity: signed capture, hardware attestation | — | Out of scope (concept documented) |
| **Template theft** | Template store | Exfiltrate stored biometric templates | Encryption at rest, template protection (BTP) | ISO/IEC 24745 | Concept only (prototype stores embeddings) |
| **Model inversion** | Template store | Reconstruct a usable face from a stolen embedding via gradient descent | Irreversible/protected templates (sMPC, salting) | ISO/IEC 24745 | Concept (informs governance) |
| **GAN reconstruction** | Template store | Train a generator to map embeddings → face images | Same as model inversion; cancelable templates | ISO/IEC 24745 | Concept |
| **Cross-bank / cross-service replay** | Template store | Replay a stolen template against another service on the same vendor model | Per-tenant non-invertible transform, unlinkability | ISO/IEC 24745 | Concept (the Onfido salting question) |
| **Replay of a legit capture** | Transport | Resend a previously valid capture | Challenge-response, nonce, TLS, session binding | — | Partial (challenge logic, Phase 3) |
| **Adversarial perturbation** | Matching | Crafted pixels that fool the matcher | Robust models, input checks, ensemble/second opinion | evolving | Research interest (VLM second opinion) |
| **Demographic exploitation** | Matching | Target the group the matcher serves worst | Bias monitoring, per-group thresholds | NIST FRTE/FATE | v1 bias panel measures this |
| **Data-at-rest / privacy breach** | Template store | Unauthorised access to biometric data | Encryption, residency controls, retention limits | GDPR / ISO 24745 | Governance design (Phase 2) |

## Defense families (the toolkit)

**Liveness / PAD** — proves a live human is present now. Active (randomised challenge) defeats static and simple replay; passive (texture, depth, reflection) adds a low-friction layer; neither alone stops good deepfakes or 3D masks. Measured by APCER/BPCER/ACER.

**Capture integrity** — proves the image came from a real camera, not an injected stream. Separate from liveness and from template privacy. Signed capture payloads and hardware attestation live here.

**Template protection (BTP)** — makes a stolen template useless: irreversibility, unlinkability, renewability (ISO/IEC 24745). Realised via cancelable transforms, sMPC/ZKB (neither party holds the full template), or homomorphic encryption.

**Freshness** — nonces and challenge-response stop replay by making each auth unique.

**Bias monitoring** — treats unfair accuracy as a security and compliance failure, not just a quality one. Aggregate numbers hide it; per-group measurement surfaces it.

## What this prototype defends, honestly

v1 measures matching accuracy and demographic differential. v2 adds *simulated* print/screen liveness — useful for exercising APCER/BPCER and the harness, but not iBeta-grade and not a defense against good attacks. The prototype does **not** implement capture integrity, real template protection, or production liveness. Those are documented as concepts (this file + ATLAS §6) so the governance narrative is complete even where the code stops. Stating that boundary is part of the point: a credible biometric story names what it does not defend.
