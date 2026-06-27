# Atlas — Biometric Authentication, Face Recognition & the AI Layer

> A working reference for the bio-authN project. Domain and tech vocabulary first, because you can only be sharp about eval, token economy, infra, and governance once the substrate is precise. Definitions are written for a practitioner, not a newcomer — tight, with the "why it matters" attached where it changes a decision.
>
> Conventions: **Term** *(abbreviation)* — definition. Where a term is contested or evolving, the disagreement is named rather than smoothed over. Standards and regulatory facts current as of June 2026.

---

## 1. Identity & access fundamentals

The scaffolding biometrics plug into. Biometric auth is never the whole system — it's one factor inside an identity stack.

**Identity Provider** *(IdP)* — the system that holds identities and issues assertions about them ("this is user X, authenticated at level Y"). Biometric matching feeds a signal into the IdP; it rarely is the IdP.

**Authentication** *(AuthN)* — proving you are who you claim to be. Biometric verification is an AuthN method.

**Authorization** *(AuthZ)* — deciding what an authenticated identity is allowed to do. Distinct from AuthN; a face match answers "who," not "what you can touch."

**Factor** — a category of authentication evidence: something you know (password), something you have (device, passkey), something you are (biometric). Two *different* categories make a multi-factor.

**Multi-Factor Authentication** *(MFA)* — two or more factors from different categories. Two passwords is not MFA; a passkey plus a face is.

**Strong Customer Authentication** *(SCA)* — the PSD2 requirement (EU/UK) for two independent factors from different categories on payment and account access, with dynamic linking to the transaction. The open question for any selfie-auth product: does the face plus the device-bound key count as two *independent* factors, or is the device doing double duty?

**Step-up authentication** — demanding additional/stronger proof at a high-risk moment (large transfer, credential change, viewing a full account number) rather than on every login. The natural home for selfie-auth: high assurance when it's worth the friction.

**Single Sign-On** *(SSO)* — one authentication grants access to many services. Context, not a biometric concept, but it's where the assertion travels.

**OAuth 2.0** — a delegation/authorization framework: issues access tokens so an app can act on a resource without holding the user's credentials. It is *authorization*, frequently misdescribed as login.

**OpenID Connect** *(OIDC)* — an authentication layer on top of OAuth 2.0. Adds an ID token (a signed JWT) asserting who the user is. This is the "login with…" pattern.

**JSON Web Token** *(JWT)* — a signed, base64 token carrying claims. The container an OIDC assertion rides in.

**FIDO2 / WebAuthn** — a standard for phishing-resistant, public-key authentication. The device holds a private key; it signs a server challenge; the private key never leaves the device. A biometric (Face ID, fingerprint) *unlocks the key locally* — the biometric is not transmitted. Proves "you possess and control this device."

**Passkey** — the consumer-facing name for a FIDO2/WebAuthn credential, usually syncable across a user's devices via a platform keychain. Critical distinction from selfie-auth: a passkey proves *device possession*; selfie-auth proves *the person*. They are complementary — passkey for daily login, biometric for step-up and recovery when the device itself is the thing in question.

**Device binding** — cryptographically tying a credential or session to a specific device (keypair in secure hardware). Underpins the "something you have" factor and most fraud controls.

**Level of Assurance** *(LoA)* — graded confidence in an identity claim (e.g. eIDAS Low / Substantial / High; NIST IAL/AAL). Regulators and frameworks speak in LoAs; a biometric method earns or loses LoA based on its PAD strength and binding.

---

## 2. Biometric core concepts

**Biometric modality** — the trait measured: face, fingerprint, iris, voice, palm vein, gait, keystroke dynamics. This project is face.

**Behavioural biometric** — identity inferred from *how* you act (typing rhythm, swipe pressure, gait) rather than a static trait. Continuous and passive, lower assurance, used for risk scoring rather than as a hard gate.

**Enrollment** *(enrolment)* — the first capture that creates the stored reference. Quality here bounds every later match. In ZKB systems, enrollment must happen through the device SDK or the security property is lost.

**Verification (1:1)** — "are you who you claim to be?" One probe compared against one stored reference. Authentication is 1:1.

**Identification (1:N)** — "who are you, among everyone enrolled?" One probe searched against the whole gallery. Watchlists and dedup are 1:N; it is a harder problem and error compounds with N.

**Probe** — the freshly captured sample presented at auth time.

**Gallery / reference** — the stored enrolled sample(s) the probe is matched against.

**Template** — the numerical representation of a biometric extracted by a model. For face, a vector of floats (the embedding). Not the image. See §4.

**Genuine vs impostor** — a genuine pair is two samples from the same person; an impostor pair is from two different people. All accuracy metrics are built from the score distributions of these two populations.

**Matching score / distance** — the similarity (or distance) between probe and reference. A threshold turns the score into accept/reject. Everything in §5 is about choosing that threshold well.

---

## 3. Face recognition technology

**Face detection** — locating faces in an image (bounding box) before anything else. Models: MTCNN, RetinaFace, BlazeFace, MediaPipe Face Detection.

**Facial landmarks** — keypoints on the face (eye corners, nose tip, mouth). 5-point for alignment; 68-point (dlib) or 468-point 3D mesh (MediaPipe Face Mesh) for geometry, pose, and liveness.

**Face alignment** — warping the detected face to a canonical pose/scale before embedding, so the model sees a consistent input. Skipping it degrades match accuracy.

**Convolutional Neural Network** *(CNN)* — the deep network architecture that turns aligned pixels into an embedding. The "proprietary model" every biometric vendor trains is, at core, a CNN (increasingly with transformer components).

**Embedding** — the output vector (typically 128–2048 dimensions; ArcFace is 512) encoding learned facial features. Two embeddings of the same face sit close together in vector space; different faces sit far apart. Vendor embeddings are *not interchangeable* — a Mitek vector is meaningless to Onfido.

**Embedding space** — the high-dimensional space (512 axes for ArcFace) the embeddings live in. The model is trained so that identity becomes geometry: every image is a point, all images of one person form a tight cluster, and different people occupy separate regions. Matching is then just measuring the distance (or angle) between two points, and the threshold is a distance cut-off. Errors concentrate where clusters sit close or overlap — that's where false accepts and the uncertain band live.

**Dimensionality reduction (PCA / UMAP / t-SNE)** — techniques that project the 512-D embeddings down to 2-D so the cluster structure can be drawn and inspected. PCA is linear and fast (keeps the directions of greatest variance); UMAP and t-SNE are non-linear and better at preserving local clusters. Visualisation only — matching always uses the full-dimensional vectors, never the 2-D projection.

**ArcFace** — a face-recognition model/loss (Additive Angular Margin) that produces highly discriminative 512-d embeddings. The open, production-grade matcher this project treats as ground truth. Reachable via DeepFace.

**FaceNet** — earlier influential embedding model (Google, 2015) using triplet loss. Historical reference point; ArcFace generally outperforms it.

**InsightFace / Buffalo_L** — an open-source face-analysis toolkit; Buffalo_L is a strong packaged model pack. The SOTA-open comparison point against ArcFace.

**DeepFace** — a Python wrapper exposing several backends (ArcFace, FaceNet, VGG-Face, etc.) behind one API. Convenience layer for the matching engine.

**Cosine similarity / cosine distance** — the usual way to compare face embeddings: the angle between two vectors. Similarity near 1 = same person; distance = 1 − similarity. Thresholds (e.g. ArcFace ~0.68 cosine distance) are tuned, not universal.

**Euclidean / L2 distance** — straight-line distance between embeddings; an alternative to cosine. Some models are trained for one metric specifically — using the wrong one quietly degrades accuracy.

**Vision-Language Model** *(VLM)* — a model that takes images and text and reasons in natural language (Claude Vision, GPT-4o). In a biometric pipeline it can *describe* why two faces differ ("lighting and ~30° yaw difference") but is a weak, expensive, non-deterministic *decider*. The research path exists to map exactly where VLMs help and where they don't.

---

## 4. Liveness & presentation attack detection

The hard part. Matching two faces is solved; proving the face in front of the camera is a live human, right now, is where systems are actually attacked.

**Presentation Attack** *(PA)* — any attempt to defeat the sensor with a fake: printed photo, screen replay, video, 3D mask, deepfake.

**Presentation Attack Detection** *(PAD)* — liveness detection. The countermeasure family. "Liveness" and "PAD" are used interchangeably; PAD is the standards term.

**Presentation Attack Instrument** *(PAI)* — the specific artefact used in an attack (the print, the mask, the replay device). PAD is benchmarked per PAI *species*.

**Active liveness** — the user performs a randomized challenge (blink, turn head, smile, follow a dot). Defeats static photo and simple replay because a recording can't answer a random prompt. Adds friction and a few seconds of latency. This project's primary defence.

**Passive liveness** — liveness inferred from a single capture without asking the user to do anything (texture, micro-reflections, depth cues, moiré). Lower friction, harder to build well. Best systems fuse active + passive.

**Eye Aspect Ratio** *(EAR)* — ratio computed from eye landmarks; drops sharply (~0.25 → <0.1) on a blink. The cheap, reliable signal behind in-browser blink detection.

**Head pose / yaw / pitch / roll** — 3D orientation of the head derived from landmark geometry. Yaw crossing ±15° confirms a "turn your head" challenge.

**Injection attack** — bypassing the camera entirely to feed a synthetic stream straight into the app (virtual camera, compromised SDK). PAD that only inspects pixels won't catch it — this is why capture integrity (signed capture, e.g. Mitek's `encryptedPayload`) matters separately from liveness.

**Replay attack** — presenting previously captured legitimate video/audio. Defeated by randomized active challenges, not by static checks.

**Deepfake / face swap** — AI-generated or face-swapped video of the target. The fastest-moving threat; defeats naive liveness and is the reason "good enough for a prototype" liveness is explicitly not production-grade.

**3D mask attack** — a sculpted/printed mask with real depth. Defeats 2D and many depth-based checks; the high end of presentation attacks.

**ISO/IEC 30107-3** — the international standard for *testing* PAD. Defines the metrics below and the certification target.

**iBeta Level 1 / Level 2** — independent PAD conformance testing against ISO/IEC 30107-3. Level 1 covers low-effort artefacts (print, screen); Level 2 covers high-effort, custom-made PAIs (masks, sophisticated replays). "iBeta Level 2 certified" is the credibility bar for banking liveness.

PAD error metrics (the PAD analogue of FAR/FRR):

| Metric | Full name | Meaning |
|---|---|---|
| **APCER** | Attack Presentation Classification Error Rate | Share of attacks wrongly accepted as live. The security number. |
| **BPCER** | Bona fide Presentation Classification Error Rate | Share of genuine users wrongly rejected as attacks. The friction number. |
| **ACER** | Average Classification Error Rate | Mean of APCER and BPCER. A single headline figure (deprecated in newer revisions but still quoted). |

---

## 5. Accuracy & evaluation metrics

The spine of this project. If you can't measure a matcher, you can't govern it or price it.

**False Accept Rate** *(FAR)* / **False Match Rate** *(FMR)* — how often an impostor is accepted. The security failure. FMR is the matcher-only term; FAR includes system effects. Lower is more secure.

**False Reject Rate** *(FRR)* / **False Non-Match Rate** *(FNMR)* — how often a genuine user is rejected. The usability failure. Every rejected legitimate customer is a support call or an abandonment.

**The FAR/FRR trade-off** — they move in opposite directions as you slide the threshold. Tighten to cut impostors (lower FAR) and you reject more genuine users (higher FRR). There is no free setting; you pick where on the curve the business sits. Naming this trade-off explicitly is the entire job.

**Equal Error Rate** *(EER)* — the threshold where FAR = FRR. A single comparison number between matchers, but rarely the operating point — banks run far tighter than EER on the security side.

**Failure to Enrol** *(FTE)* — share of users who can't produce a usable enrollment at all (poor camera, lighting, disability). An inclusion metric; high FTE is an exclusion problem.

**Failure to Acquire** *(FTA)* — share of attempts where no usable sample is captured at auth time. Friction and accessibility signal.

**Receiver Operating Characteristic** *(ROC)* — curve of true-accept rate against false-accept rate across all thresholds. The standard way to *see* a matcher's whole behaviour rather than one operating point.

**Detection Error Tradeoff** *(DET)* — FRR vs FAR plotted on a normal-deviate scale; the biometrics community's preferred curve because it spreads out the low-error region where decisions actually happen.

**Area Under Curve** *(AUC)* — single scalar summarising ROC. Useful for ranking, blind to *where* on the curve you operate.

**TAR @ FAR** — True Accept Rate measured at a fixed FAR (e.g. TAR @ FAR=1e-4). How vendors and NIST actually report: "at one-in-ten-thousand false accepts, we let in 98.5% of genuine users." The honest way to state accuracy.

**Threshold tuning** — choosing the score cutoff for a target FAR on representative data. The hardcoded 0.68 in early notes is a starting guess; sweeping the threshold on a corpus and reading the ROC is the actual method.

**Demographic differential / biometric bias** — systematic accuracy variation across skin tone, age, sex. A matcher can post a great aggregate FRR and still reject one demographic at several times the rate. This is the metric that gets a bank fined and the reason aggregate numbers lie. The bias panel is a first-class deliverable, not a footnote.

**Calibration** — whether a model's stated confidence matches its real accuracy (a "0.9 confident" set should be right ~90% of the time). VLMs are often badly calibrated — confidently wrong — which is precisely why their scores can't be trusted as a gate without measuring this.

**NIST FRTE / FATE** — the US government's ongoing, independent face benchmarks, run by NIST. In August 2023 the long-running **FRVT** was split and renamed: **FRTE** (Face Recognition Technology Evaluation) covers verification/identification accuracy; **FATE** (Face Analysis Technology Evaluation) covers PAD, morph detection, quality, and age estimation. The neutral reference point for "how good is good," and the public source for demographic-differential data.

---

## 6. Template protection & privacy architectures

Why biometrics are not passwords: a stolen password is reset; a stolen face is permanent. This section is the security-design core of the project.

**Biometric Template Protection** *(BTP)* — techniques that store the template such that a breach doesn't expose the underlying biometric. Standardised in **ISO/IEC 24745**.

**Irreversibility** — the property that the stored template can't be turned back into the original biometric. Not absolute for raw embeddings — see model inversion.

**Unlinkability** — the property that templates of the same person across systems can't be correlated. The defence against cross-bank replay.

**Renewability / cancelable biometrics** — the ability to revoke a compromised template and issue a fresh, different one from the same face (typically by changing a transform/salt). Restores the "reset" property biometrics otherwise lack.

**Salting (per-tenant transform)** — applying a non-invertible, tenant-specific transform so the same face yields different templates per bank. Without it, one vendor model shared across banks means a stolen template from Bank A is mathematically comparable at Bank B. The Onfido cross-bank question turns on whether this is applied.

**Model inversion attack** — reconstructing a usable synthetic face from a stolen embedding by running gradient descent against the known model. The reason "embeddings lose information, so they're safe" is only half true.

**GAN reconstruction** — training a generative model to map embeddings back to face images. A second, often stronger, route from template to a replayable face.

**Cross-bank replay** — reusing a stolen template against a different institution that runs the same vendor model. Database isolation doesn't prevent it; only per-tenant template transformation does.

**Secure Multi-Party Computation** *(sMPC)* — a cryptographic method letting parties jointly compute a function over inputs none of them fully holds. The basis of split-template biometrics.

**Zero-Knowledge Biometrics** *(ZKB)* — a system (e.g. Keyless) where neither device nor server ever holds the complete template. Device holds a mask R; server holds F − R; the match computes distance with R cancelling out, so the server learns the result without seeing the face. Breach of either side alone yields nothing usable, and templates become cancelable by re-masking. **Hard dependency:** the device SDK must take part in every auth — a backend-API "send the selfie to the server" integration is *not* ZKB, it's plaintext server-side matching wearing the same brand.

**Homomorphic Encryption** *(HE)* — computing directly on encrypted data. An alternative privacy route to sMPC for biometric matching; generally heavier on compute/latency.

**Fuzzy vault / fuzzy commitment** — classic BTP schemes that bind a secret key to noisy biometric data so a close-enough sample releases the key without storing the biometric in the clear. Older lineage than sMPC/HE; useful conceptual grounding.

**Special category data** — under UK/EU GDPR, biometric data used for identification is a special category requiring an explicit lawful basis and heightened safeguards. The permanence problem made into a legal obligation.

---

## 7. Standards & certifications

Full practitioner depth in `STANDARDS.md`. Main entries:

**ISO/IEC 2382-37** — biometrics vocabulary standard; the authority on precise term definitions when two teams or vendors mean different things by "verification."

**ISO/IEC 30107-3** — the PAD testing standard; defines APCER, BPCER, and ACER and sets the methodology any liveness claim must cite.

**iBeta Level 1 / Level 2** — NIST/NVLAP-accredited lab for commercial PAD testing against 30107-3; Level 2 (high-effort artefacts, masks, sophisticated replays) is the banking liveness credibility bar.

**ISO/IEC 24745** — biometric information protection; sets the three required template properties: irreversibility, unlinkability, and renewability. The gap between "encryption at rest" and actual 24745 compliance is where model-inversion and cross-bank-replay risk lives.

**ISO/IEC 19794 / 39794** — biometric data interchange formats; 39794 is the extensible ICAO replacement for ePassports; governs how a face record is structured when data crosses vendor or system boundaries.

**NIST FRTE / FATE** — US government's independent face benchmarks (renamed from FRVT in August 2023); FRTE covers verification/identification accuracy, FATE covers PAD and bias data — the public yardstick vendors' own marketing won't volunteer.

**FIDO2 / WebAuthn** — the credential standard behind passkeys; the biometric only unlocks a local key and is never transmitted. Proves device possession, not personhood — complementary to selfie-auth, not a substitute.

---

## 8. Regulation (UK/EU focus)

Full practitioner depth in `COMPLIANCE.md`. Main entries:

**UK GDPR + Data Protection Act 2018** — biometric data used for identification is special-category data; requires explicit lawful basis, a DPIA, and retention/erasure architecture. The sharp edge: what happens to an auth template seeded from an IDV selfie when the source is deleted?

**Information Commissioner's Office (ICO)** — UK data-protection regulator; has issued specific biometric guidance and enforced against biometric deployments; the body a DPIA is written to satisfy.

**PSD2 / Strong Customer Authentication (SCA)** — mandates two independent authentication factors from different categories with dynamic transaction linking; the open question is whether selfie-auth plus a device-bound key counts as two independent factors or just one.

**Financial Conduct Authority (FCA)** — UK financial regulator; any SCA interpretation — what qualifies as a factor, what binding is acceptable — must be validated here before treating selfie-auth as a regulated gate.

**UK DIATF / DVS Trust Framework** — the UK government scheme certifying digital-identity providers; Gamma (0.4) entered force July 2025, formalised as DVS v1.0 in March 2026; the certification route for reusable digital identity in the UK.

**eIDAS 2.0** — EU Regulation 2024/1183, in force May 2024; mandates member-state EUDI Wallets by December 2026, with regulated sectors (banking included) required to accept them by late 2027.

**EUDI Wallet** — member-state wallet holding verifiable credentials at LoA High; parts of the auth/onboarding flow you build today may need to interoperate with it within a couple of years.

**BIPA** — Illinois Biometric Information Privacy Act; US-scoped but set the global industry tone on explicit biometric consent and statutory damages; a reference point even for UK/EU product decisions.

---

## 9. IDV & onboarding

The front door biometrics often enter through.

**Identity Document Verification** *(IDV)* — proving a presented identity document is genuine and belongs to the presenter. The regulatory gate at onboarding; if it fails, onboarding stops.

**Know Your Customer / Anti-Money-Laundering** *(KYC / AML)* — the regulatory obligations IDV exists to satisfy.

**Document liveness / document PAD** — detecting fake or copied documents (screen-of-a-passport, printed copy), analogous to face liveness but for the document.

**NFC chip read** — reading the cryptographically signed chip in an ePassport/eID for the highest-assurance document check. Defeats most document forgery because the data is signed by the issuing authority.

**Face-on-document match** — comparing the live selfie to the photo extracted from the ID document. The bridge between IDV and selfie-auth: the onboarding selfie can seed the ongoing auth template.

**Optical Character Recognition** *(OCR) / data extraction** — pulling text fields from the document image. Increasingly where VLMs are tried.

**IDV-seeded enrollment** — using the onboarding IDV selfie to create the auth reference template, removing a separate enrollment step. Lowest friction, but raises the GDPR question of what happens to the auth template when the source IDV selfie is erased.

---

## 10. The AI layer — eval, governance, token economy, infra

The project's reason for being. These are the four dimensions a platform PM owns once the matching substrate is understood.

### Eval

**LLM-as-judge** — using a language/vision model to score or adjudicate. Powerful and cheap to stand up, but needs its own validation (calibration, agreement with ground truth) before its verdicts can be trusted — otherwise you've added a confident, unmeasured oracle to a regulated decision.

**Confidence vs calibration** — a model's stated confidence is not its accuracy until you've measured calibration (§5). Treat raw VLM confidence as a claim to be tested, not a number to be believed.

**Hallucination** — a model producing fluent, plausible, wrong output. In a matcher, a hallucinated "these are the same person, high confidence" is a security event.

**Uncertain band / second-opinion routing** — the region of matcher scores (e.g. ArcFace cosine ~0.55–0.75) where the primary matcher is least reliable. The defensible place to spend a VLM call: route only ambiguous cases to a slower, costlier reasoner, not every transaction. This is where eval and token economy meet.

**Drift** — degradation of model accuracy as real-world inputs diverge from training data (new phones, camera changes, demographic shifts). The reason eval is continuous, not a one-time gate.

**Ground-truth corpus** — the labelled set of genuine/impostor pairs every metric is computed against. For this project: synthetic, demographically labelled faces for eval, plus ephemeral live self-capture for the interactive flow.

### Governance

**Model card** — a standardised description of a model: intended use, training data character, measured accuracy *by demographic*, known limits. The artefact a reviewer or regulator reads before trusting a matcher.

**Audit log** — an immutable, per-decision record (which matchers fired, scores, threshold applied, outcome, consent state). The difference between "the system decided" and "we can show why the system decided."

**Explainability** — surfacing, per decision, why an accept/reject happened in terms a human reviewer can act on. For VLMs this is their genuine strength (natural-language reasoning); for embedding matchers it's a distance and a threshold.

**Evidence pack** — the per-decision bundle a reviewer can open: inputs, every matcher's output, the policy applied, consent and retention state, the model cards in force. Governance rendered as something you can actually click into.

**Policy-as-config** — thresholds, routing rules, and fallbacks held as version-controlled configuration rather than buried in code. Lets risk/compliance change the operating point without a deploy, and lets the audit log reference exactly which policy version ran.

**Consent & retention model** — the recorded lawful basis for capturing the biometric and the rules for how long each artefact lives and when it's deleted. A governance object, not a checkbox.

**Data lineage** — tracking where each piece of biometric data came from, what it seeded, and what must cascade on erasure. The thing that answers "the IDV selfie was deleted — what happens to the auth template?"

### Token economy

**Token** — the unit a VLM/LLM bills and computes in. An image consumes input tokens (scaled by resolution); the model's reasoning consumes output tokens.

**Token accounting** — measuring input + output tokens per call, per decision. The raw material of unit cost. The project instruments this rather than quoting a flat "~$0.01/call."

**Cost-per-verification** — the fully loaded cost of one auth decision across whatever matchers fired. The number that decides whether a VLM second opinion is affordable at scale.

**Unit economics of assurance** — the core economic question the architecture poses: extra assurance costs tokens and latency, so where is it worth paying? The honest answer is selective (uncertain-band routing), not "run everything every time."

**Cost/latency/accuracy frontier** — the three-way trade. ArcFace is fast/free/deterministic; a VLM is slow/costly/explanatory. There is no matcher that wins all three; the design picks per-decision.

### Infrastructure

**Provider abstraction** — a common interface behind every matcher (ArcFace, VLM-via-API, local VLM, cloud baseline) so they can be swapped, compared, or fallen back to without rewiring. The thing that makes "compare techniques" tractable.

**Parallel fan-out** — running multiple matchers concurrently on one probe and combining results, rather than serially. Keeps latency near the slowest matcher instead of the sum.

**Score fusion** — combining multiple matchers' outputs into one decision (weighted, rule-based, or learned). How a multi-matcher or multi-modal system reaches a single accept/reject.

**Latency budget** — the total time the user will tolerate, allocated across capture, liveness, match, and any second opinion. Active liveness and VLM calls are the expensive line items; the budget forces the routing discipline.

**Resilience: active-passive vs intelligent routing** — for a regulated gate (IDV) you need a second vendor ready: *active-passive* keeps a hot standby; *intelligent routing* sends traffic to whichever vendor is healthy/cheaper/more accurate per request. Selfie-auth tolerates a softer fallback (OTP/passkey); IDV does not.

**Fallback** — the defined path when the primary biometric fails or is unavailable (OTP, passkey, manual review). Its strength is set by how regulated the use case is.

---

## 11. Market & vendors (reference)

Named for orientation; not endorsements. Architecture matters more than brand — the same brand can ship a ZKB integration or a plaintext one (see §6).

| Vendor / product | What it is | Notable architectural point |
|---|---|---|
| **Mitek — MiPass** | Selfie-to-auth, bank-focused | Template-based, server-side matching |
| **Mitek — MiSnap** | Capture SDK (distinct from MiPass) | `encryptedPayload` proves capture integrity, *not* template privacy |
| **Onfido (Entrust)** | IDV + biometric auth, strong UK banking presence | Single model across clients → the cross-bank replay question turns on per-tenant salting |
| **Keyless (Ping Identity)** | Zero-Knowledge Biometrics via sMPC | ZKB property holds *only* with device-SDK enrollment; backend-API mode loses it |
| **iProov** | Specialist liveness/PAD | "Flashmark" challenge; the dedicated-liveness tier prototypes are measured against |
| **FaceTec** | Specialist 3D liveness | 3D face mapping; common high-assurance liveness benchmark |
| **AWS Rekognition** | Cloud face compare/detect | Cloud production baseline; cheap per call, no on-prem control |
| **Jumio / Persona / Idemia / NEC** | IDV / biometric suites | Reference points for breadth of the IDV+auth market |

---

## 12. Quick disambiguations (the ones people get wrong)

- **AuthN ≠ AuthZ.** Who you are vs what you may do.
- **FAR/FMR ≠ APCER.** FAR is impostor-accepted-as-genuine (matching); APCER is attack-accepted-as-live (liveness). Different failures.
- **Passkey ≠ selfie-auth.** Device possession vs personhood. Complementary, not substitutes.
- **Capture integrity ≠ template privacy.** Signed capture (anti-injection) says nothing about how the template is stored.
- **"Keyless/ZKB integration" ≠ ZKB.** Without device-SDK enrollment there is no mask, so it's plaintext server-side matching.
- **Aggregate accuracy ≠ fair accuracy.** A strong overall FRR can hide a demographic rejected several times more often.
- **VLM confidence ≠ VLM accuracy.** Not until calibration is measured.
- **EER ≠ operating point.** Banks run far tighter than equal-error on the security side.

