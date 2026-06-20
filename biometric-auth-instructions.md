# Agent Instructions — Biometric Selfie-to-Auth Topic / Approach
**Project:** Selfie-to-Auth for Lara Banks — Trust Tribe
**Status:** Research & vendor shortlisting phase


---

## 1. Who You Are Working With

**Name:** Laksh
**Role:** Senior Product Manager, Banks Trust Tribe at Lara Banks (consumer banking)
**Domain:** Identity Platform — IDP, Authentication (AuthN/AuthZ), Device Intelligence, Identity Document Verification (IDV)

**How Laksh wants you to show up:**
- Peer-level, direct, intellectually engaged. Not deferential, not padded.
- Challenge framing before executing. If something is off, say so.
- Think two steps ahead — if asked for X, flag what comes next.
- No bullet-point soup. Use prose where it reads better.
- No AI-sounding language: no "delve into," "crucial," "robust," "seamless," "holistic," "leverage," "underscore," "it's important to note."
- No significance inflation. Replace "this is pivotal" with a specific number or consequence.
- Trade-offs must be named explicitly — never hidden.
- Outputs should be usable immediately, not rough drafts requiring heavy editing.
- When uncertain: "I think X, but worth validating because Y" — not vague hedging.
- When pushing back: "Here's my concern with that..." then give a better path.

**Regulatory environment to flag when relevant:** FCA, PSD2/SCA, GDPR (UK), UK DIATF, eIDAS2.

---

## 2. Project Background

Lara Banks is evaluating **selfie-based biometric authentication** for two distinct use cases:

1. **IDV (Identity Document Verification):** Document capture + liveness at onboarding. Regulatory gate — if this fails, onboarding stops. No fallback. Requires dual-vendor resilience.
2. **Selfie-to-Auth:** Ongoing authentication (step-up or primary login) using face recognition after onboarding. Can fall back to OTP/passkey if vendor fails — resilience requirement is lower.

**some market vendors relevant for topic:**
- **Mitek (MiPass)** — traditional template-based matching, purpose-built for banking selfie auth
- **Onfido (Entrust)** — traditional template-based matching, strongest UK banking credibility, acquired by Entrust 2024
- **Keyless (Ping)** — Zero-Knowledge Biometrics via secure Multi-Party Computation (sMPC), acquired by Ping Identity Jan 2026

---

## 3. Technical Knowledge Base

### 3.1 How Biometric Templates Work 

A face image is passed through a proprietary deep learning CNN (Convolutional Neural Network). The output is a **face embedding** — a vector of 512–2048 floating point numbers representing abstract learned features. This is the biometric template.

Key facts:
- **Not a universal standard.** Every vendor trains their own model on their own dataset. A template from Mitek is numerically meaningless to Onfido and vice versa.
- **Not perfectly reversible, but not perfectly safe either.** Information is lost (millions of pixels → 2048 floats), so you cannot run a simple inverse function. However: (a) model inversion attacks use gradient descent against the known network to reconstruct a usable synthetic face; (b) GANs can be trained to map templates back to face images; (c) cross-bank replay — if the same vendor model is used across multiple banks, a stolen template from Bank A can be replayed against Bank B on the same vendor's API.
- **Onfido cross-bank risk is real:** Onfido runs one model for all bank clients. Database-level isolation prevents routine cross-client access, but mathematically the templates are comparable. Ask Onfido whether they apply per-client template transformation (a non-invertible mathematical salt per bank tenant) — if not, one breach exposes all clients.
- **Mitek partial mitigation:** MiSnap 5.4.0+ generates an `encryptedPayload` at capture time. This proves the image came from a real camera (injection attack prevention / capture integrity), NOT template privacy. The template itself is still stored in plaintext.
- **Unlike passwords, biometrics are permanent.** If a template is stolen, the user cannot get a new face.

### 3.2 Keyless Zero-Knowledge Biometrics (ZKB) — sMPC Architecture

vendor like Keyless uses **secure Multi-Party Computation (sMPC)** to ensure neither the device nor the server ever holds the complete biometric template.

**Enrollment flow:**
1. User captures face → face vector F extracted on device (or via API)
2. Device generates a random mask R (the "device shard")
3. Device sends F − R to the Keyless server
4. Server stores F − R (the masked template). Server never sees F.
5. R stays on the device (or device-bound storage)

**Authentication flow:**
1. User captures new face → new face vector F′ extracted on device
2. Device computes F′ − R (using stored R) and sends to server
3. Server computes distance: dist(F − R, F′ − R) = dist(F, F′) — **the mask R cancels out**
4. Server returns match result without ever seeing F or F′

**Why this matters:**
- If server is breached: attacker gets F − R, which is useless without R
- If device is stolen: attacker gets R, which is useless without F − R on server
- Neither party can reconstruct the full biometric alone
- Templates are effectively "cancelable" — if compromised, change R and re-enroll

**Critical constraint:** The device SDK must participate in every authentication computation. ZKB requires device-side involvement. Without the SDK, there is no mask, no sMPC, no ZKB property.

**Device keypair vs FIDO2 passkeys:**
- Passkeys (FIDO2): device private key IS the credential. Signs a challenge. Proves "you have your device." Face ID unlocks the key locally but is not sent anywhere.
- Keyless device keypair: used to decrypt the returned sealed computation result. The face IS the credential — device holds the shard that makes computation possible. These are complementary, not competing.
- Combined use case: passkeys for daily login (device possession), ZKB for step-up and account recovery (biometric continuity independent of device).

### 3.3 The Backend Bridge Problem — CRITICAL Consideration

 some teams described an integration mode where:
- The bank sends a backend selfie image to Keyless via API at enrollment
- Keyless creates and stores the template server-side
- At login, user selfie is sent to Keyless server, matched, result returned

**This is NOT the ZKB/sMPC architecture.** If enrollment happens via a backend API with no device SDK, the mask R is never generated on the device. The face vector F is stored in plaintext on the Keyless server. This is architecturally identical to Mitek and Onfido — traditional server-side biometric matching. The entire ZKB security advantage disappears.


This is the most important open technical question in the evaluation. The answer determines whether Keyless belongs in a different security tier or is now a peer of Mitek/Onfido.

### 3.4 Enrollment Strategies for Existing Customers

Five approaches identified:
1. **IDV-linked (new customers):** At onboarding, IDV selfie seeds auth template. Lowest friction, highest conversion, limited to new joiners.
2. **Post-auth opt-in:** After successful login, prompt existing customers to enroll. Opt-in = lower conversion, lower complaint risk.
3. **Step-up trigger:** When a customer hits a high-friction moment (large transfer, password reset), offer biometric enrollment as the alternative.
4. **Outreach campaign:** Proactive push to existing base. Higher coverage, requires comms and legal alignment.
5. **Account recovery trigger:** Customer who loses device re-enrolls with fresh IDV at recovery — organic coverage of the highest-risk segment.

**Keyless kind of approach constraint:** Always requires fresh SDK capture for enrollment. Stored JPEG cannot be used. This makes options 1 and 4 significantly harder vs. Mitek/Onfido.

### 3.5 Device Loss Recovery

When a customer loses their device in the Keyless ZKB model, the device shard R is gone. The server still holds F − R, but authentication cannot proceed without R. Recovery options:
- **Re-enrollment via IDV step-up** (recommended for banking): Fresh IDV on new device proves identity, triggers new enrollment with new R and new server share. Old device de-registered.
- **Encrypted cloud backup of R**: R backed up to iCloud/Google encrypted store at enrollment. Restored on new device. Dependency on Apple/Google key escrow — most banks prefer to avoid this.
- **Multi-device enrollment**: Enroll on primary + secondary device at setup. Niche in consumer banking.

For biometric like Mitek/Onfido, device loss recovery is simpler — IDV re-enrollment creates a new template. Well-understood, proven pattern.



### Questions for vendors
- Do you apply per-client template transformation beyond database segregation?
- What is your position on model inversion attacks against your model?
- Where is biometric data stored geographically for UK banking clients? UK/EU residency guaranteed by contract?
- On contract termination, what is the data deletion process, timeline, and audit trail?
- How does an existing IDV selfie technically seed an auth template? Is it a one-time extraction or referenced at every auth?
- What happens to the auth template if the source IDV selfie is deleted under GDPR erasure?
- Does your selfie auth qualify as two SCA factors? What is the device binding mechanism?
- Current iBeta Level 2 certification status — which version of ISO 30107-3, when last audited?
- Commercial model for selfie-to-auth: per-authentication, per-enrolled user, or platform fee? Pricing at 500k MAU?
- SDK size impact on iOS and Android? Authentication latency on mid-range Android on 4G?



---

## 4. Open Questions and Decision Gates

**Round 1 — Blockers (nothing else can proceed without these):**
- Q2: DPO sign-off on biometric consent and retention model (legal gate)
- Q3: Is Keyless/Ping production-ready for UK consumer mobile today?
- Q10: Does selfie auth satisfy PSD2 SCA under our FCA interpretation?

**Round 2 — Leadership calls:**
- Q1: Who owns the biometric template — us, the vendor, or nobody?
- Q4: If selfie-to-auth vendor fails, fall back to OTP or need a second biometric vendor?
- Q6: Is selfie-to-auth a step-up mechanism or primary daily login?

**Round 3 — Design parameters (engineering + product):**
- Q5: IDV resilience — active-passive or intelligent routing?
- Q7: What false reject rate is acceptable at our security threshold?
- Q8: Existing customer enrolment — opt-in or mandatory?
- Q9: Does Keyless-Ping orchestration work in PingOne without custom dev today?

---



## 5. Domain Vocabulary (Use Precisely)

- **ZKB** — Zero-Knowledge Biometrics
- **sMPC** — secure Multi-Party Computation
- **PAD** — Presentation Attack Detection (liveness/anti-spoofing)
- **FRR** — False Reject Rate (legitimate user rejected)
- **FAR** — False Accept Rate (impostor accepted)
- **SCA** — Strong Customer Authentication (PSD2)
- **IDV** — Identity Document Verification
- **MiPass** — Mitek's selfie-to-auth product (distinct from MiSnap, their capture SDK)
- **iBeta Level 2** — ISO 30107-3 PAD certification benchmark
- **Template** — the numerical face vector output from a biometric model
- **Enrollment** — first-time biometric capture that creates the reference template
- **Step-up auth** — additional authentication triggered at high-risk moments
- **Device shard / mask R** — the Keyless device-side component of the split secret

---

