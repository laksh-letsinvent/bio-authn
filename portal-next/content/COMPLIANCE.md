# Compliance

The UK/EU regulatory obligations that shape a biometric auth product, and the design constraint each one imposes. Framed for decisions: not "what the law says" in the abstract, but "what it forces you to build differently."

> Regulatory timelines (DIATF/DVS versions, eIDAS 2.0 milestones) age fastest — re-verify before reuse. Current as of June 2026.

---

## Data protection

**UK GDPR + Data Protection Act 2018.** Biometric data used to identify a person is **special category data**. It needs an explicit lawful basis (usually explicit consent) plus a Data Protection Impact Assessment. The design constraints that follow are not afterthoughts: retention limits, data residency, and the right to erasure all become architecture. The sharp edge for selfie-auth is erasure — when a user invokes the right to be forgotten, what happens to an auth template that was *seeded* from an IDV selfie? If the source selfie is deleted but the derived template persists, you have a problem. Decide the lineage rules before building, not after a complaint.

**Information Commissioner's Office (ICO).** The UK data-protection regulator. Has issued specific guidance on biometric data and has enforced against biometric deployments. The body whose guidance your DPIA is written to satisfy.

## Payments authentication

**PSD2 / Strong Customer Authentication (SCA).** The payments rule mandating two independent authentication factors from different categories, with dynamic linking to the transaction. The question it forces: does selfie-auth plus the device-bound key count as *two independent* factors, or is the device doing double duty? The answer determines whether selfie-auth can stand as a regulated factor at all, or only as a step-up convenience on top of something else.

**Financial Conduct Authority (FCA).** The UK financial regulator. SCA is interpreted against FCA expectations, so the firm's own SCA interpretation — what counts as a factor, what binding is acceptable — is signed off here. A design assumption about SCA that hasn't been run past this interpretation is a risk, not a decision.

## Digital identity frameworks

**UK Digital Identity & Attributes Trust Framework (DIATF).** The UK government scheme certifying digital-identity providers. The **Gamma (0.4)** version came into force 1 July 2025; it was then formalised into the **DVS Trust Framework v1.0** (carrying the UK trust mark) in March 2026. This is the certification route for reusable digital identity in the UK — relevant if the product ever issues or consumes a reusable ID rather than running a closed in-house flow.

**eIDAS 2.0.** EU Regulation 2024/1183, in force since 20 May 2024. It mandates that every member state offer an **EU Digital Identity Wallet (EUDI Wallet)** by **December 2026**, with regulated sectors — banking included — required to **accept** it by late 2027. This reshapes how identity and biometrics are presented across the EU and moves some IDV/auth from bank-built flows to a user-held wallet model. A UK firm serving EU customers can't treat it as someone else's problem.

**EUDI Wallet.** The member-state-issued wallet under eIDAS 2.0, holding verifiable credentials at Level of Assurance High. The strategic implication: parts of the onboarding/auth journey you build today may, within a couple of years, be expected to interoperate with a wallet the user already holds.

## Reference point outside scope

**Illinois Biometric Information Privacy Act (BIPA).** US (Illinois) law, included because it set the global tone on biometric consent and statutory damages — the case law that made "get explicit consent before capturing a biometric" a financial reality. A reference point even for a UK/EU product, because it shapes how the whole industry treats consent.

---

## What this means for bio-authN

The prototype handles only synthetic faces and ephemeral self-capture, so it sits outside most of these obligations by design. But the governance phase (Phase 2) renders these constraints as product surfaces: a recorded consent and retention model, data lineage that answers the erasure question, and policy-as-config that an SCA/FCA interpretation can be encoded into. The point of naming them here is so the governance demo reflects real obligations rather than invented ones.
