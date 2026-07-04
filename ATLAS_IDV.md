# Atlas — Identity Document Verification (IDV)

> Companion to the face-matching Atlas. Same job: the domain and tech vocabulary, tight and practitioner-first, so you can reason about IDV before building it. The face Atlas covers the selfie side; this covers the document side and where the two meet (face-on-document match).
>
> Conventions: **Term** *(abbreviation)* — definition, with the "why it matters" attached where it changes a decision. Where a fact is dated or evolving, it's flagged. Standards and regulatory facts current as of June 2026.

---

## 1. IDV fundamentals

**Identity Document Verification** *(IDV)* — confirming a presented identity document is genuine, valid, and belongs to the person presenting it. The regulatory gate at onboarding: if it fails, onboarding stops, and unlike step-up auth there's no soft fallback.

**Identity proofing** — establishing that a claimed identity maps to a real person. IDV is the document-centric part of proofing; proofing also includes evidence scoring and resolution.

**Verification vs authentication** — verification asks "is this identity real and theirs" (onboarding); authentication asks "is this the same person returning" (login). IDV is the former; the face Atlas covers the latter.

**Know Your Customer / Customer Due Diligence** *(KYC / CDD)* — the regulatory obligation IDV satisfies at account opening.

**Anti-Money Laundering** *(AML)* — the regime KYC sits under. **Enhanced Due Diligence (EDD)** is the deeper version for higher-risk customers.

**Identity Assurance Level** *(IAL)* — graded confidence in the proofing (NIST 800-63-4: IAL1/2/3; eIDAS: Low/Substantial/High). It sets how strong the document checks must be.

**The IDV pipeline** — classify → capture → authenticate → extract → face-match → decide. Each stage is a point to pass, refer, or reject.

**Breeder document** — a foundational document (birth certificate) used to obtain others. The root of document trust, and the weak point fraudsters target.

**Proof of Address** *(PoA)* — a separate onboarding check (utility bill, statement), often paired with IDV but a different evidence type.

---

## 2. Document types & anatomy

**ePassport / eMRTD** — electronic Machine-Readable Travel Document: a passport carrying a signed NFC chip (ICAO 9303). The highest-assurance document because the data is cryptographically signed by the issuer.

**National ID, driving licence, residence permit** — the common IDV document classes, each with country-specific layouts and security features.

**Machine-Readable Zone** *(MRZ)* — the OCR-B band of characters (with check digits) encoding key fields. Formats: **TD1** (three-line ID card), **TD2**, **TD3** (two-line passport).

**Visual Inspection Zone** *(VIZ)* — the human-readable printed area: portrait, name, fields, outside the MRZ.

**Check digit** — a computed digit validating an MRZ field. A cheap integrity test, and a fast way to catch clumsy tampering.

**Security features** — anti-counterfeit elements: holograms / OVDs, optically variable ink (OVI), microprint, guilloche patterns, UV and IR features, laser-engraving (CLI/MLI), intaglio, and the ghost image.

**Ghost image** — a faint secondary portrait elsewhere on the document. A security feature and a cross-check against photo substitution.

**Optically Variable Device** *(OVD) / hologram* — an element that shifts with viewing angle, hard to reproduce in a flat copy.

**UV / IR features** — elements visible only under ultraviolet or infrared. Most phone cameras can't see them, which is a real limit of remote, phone-based IDV.

**Contactless chip (NFC)** — the eMRTD chip holding signed copies of the data and a high-resolution portrait. Reading it is the strongest single check available remotely.

**PDF417 barcode** — the 2D barcode on many driving licences encoding the holder's data; a parseable cross-check against the VIZ.

---

## 3. Capture

**Document capture SDK** — the mobile or web component that photographs the document with quality checks built in.

**Autocapture** — automatic shutter once framing, focus, and glare pass; cuts down unusable images.

**Image quality assessment** — glare, blur, resolution, crop, and completeness checks before a capture is accepted.

**NFC chip read** — reading the eMRTD chip over the phone's NFC. Verifies signed data and the chip portrait, defeating most document forgery, but constrained by device and app support.

**Passive Authentication** *(PA)* — verifying the chip's data is signed by the issuing country via the Document Signer Certificate chain. Proves the data is authentic and unaltered.

**Active / Chip Authentication** — protocols proving the chip itself is genuine and not cloned.

**Document presentation attack** — showing a fake document to the camera (print, screen, forged card). The document analog of selfie liveness.

**Injection attack (document)** — feeding a forged document image past the camera entirely. Capture integrity defends it, not pixel inspection.

---

## 4. Data extraction & reading

**Optical Character Recognition** *(OCR)* — converting document text to fields. The classic specialist route (Tesseract, ABBYY).

**MRZ parsing** — reading and validating the MRZ, including check digits. More reliable than VIZ OCR because it's structured and self-checking.

**Field extraction** — pulling structured fields (name, DOB, document number, expiry, nationality) from VIZ and MRZ.

**Document classification** — identifying document type and issuing country so the right template and rules apply. A prerequisite most pipelines run first.

**Cross-field consistency** — checking that MRZ, VIZ, barcode, and chip agree. A mismatch is a strong tampering signal.

**Template / layout model** — a per-document map of where fields sit. Specialists depend on it; a vision model largely doesn't, which is why VLMs generalize to unseen layouts.

**Character / Word Error Rate** *(CER / WER)* — extraction accuracy by edit distance over characters or words.

**Structured-field F1** — precision and recall over correctly extracted fields. The practical "did we read it right" metric.

---

## 5. Authenticity & document fraud

**Document authenticity / fraud detection** — deciding whether a document is genuine or fake.

**Counterfeit** — a wholesale fake reproduction of a real document type.

**Forgery** — alteration of a genuine document (changed photo or fields).

**Fraudulent / fantasy document** — an invented document for a non-existent authority (a camouflage passport).

**Photo substitution** — replacing the portrait on a genuine document. A common, high-impact forgery.

**Tampering** — altering printed data (DOB, name, number) on a real document.

**Specimen** — an official sample document used as the reference template for authenticity checks.

**Synthetic identity / synthetic document** — a fabricated identity or an AI-generated document. A fast-growing fraud vector, and the one generative models make cheaper.

**Tamper-detection methods** — Error Level Analysis (ELA), JPEG/noise-residual analysis, font and kerning checks, edge and template matching, copy-move detection.

**Error Level Analysis** *(ELA)* — spotting regions re-saved at a different compression level, a sign of localized editing.

**Document PAD metrics** — **APCER** (forged accepted as genuine), **BPCER** (genuine rejected as fake), **ACER** (their mean). The same family as selfie liveness, applied to documents.

---

## 6. Face-on-document match & morphing

**Face-on-document match** — comparing the portrait on the document to a live selfie. The bridge between IDV and biometric auth, and the reuse point for a face engine.

**Portrait extraction** — cropping the document photo, or pulling the chip portrait, to feed the matcher.

**Cross-domain matching** — matching a printed, low-quality document photo against a live capture. Harder than selfie-to-selfie, so it needs a looser, separately-tuned threshold.

**Chip portrait** — the high-resolution portrait read from the eMRTD chip. Better for matching than the printed photo.

**Morphing attack** — blending two people's faces into one portrait so a single passport matches both. A serious, document-specific threat to face-on-document match.

**Morph detection** — single-image (no-reference) or differential (against a live capture) detection of morphed portraits. Benchmarked publicly by NIST FATE MORPH.

---

## 7. The verification decision & proofing

**Decision outcome** — accept / refer / reject. IDV rarely just passes or fails; the middle path is referral.

**Straight-Through Processing** *(STP)* — the share of cases auto-decided with no human. The core efficiency metric.

**Manual review / adjudication** — a human checks referred cases. The cost and latency line item, and where fraud is actually caught at the margin.

**Hybrid (auto + human)** — automation clears the obvious cases, humans take the ambiguous ones. The standard production pattern.

**Evidence strength / proofing score** — the assurance a piece of evidence contributes (NIST 800-63A grades evidence FAIR / STRONG / SUPERIOR).

**Reusable identity** — a verified identity the user holds (in a wallet or credential) and re-presents, removing repeat IDV. The direction eIDAS2 and mDL push toward.

---

## 8. Accuracy & eval metrics (IDV)

Extraction uses CER, WER, field accuracy, and structured F1 (§4). Authenticity uses APCER, BPCER, ACER, and a ROC (§5). Face-match uses FAR/FRR and TAR@FAR with a document-tuned threshold (face Atlas). The business and operations metrics that sit on top:

**Fraud catch rate (recall)** — the share of real fraud caught. The security number.

**False positive rate** — genuine customers wrongly referred or rejected. Drives abandonment and support cost.

**Conversion / abandonment** — the share who complete versus drop out of onboarding. The business metric IDV friction moves directly.

**Pass rate / auto-approval rate** — the share auto-accepted, balanced against the fraud catch rate. Tightening one moves the other, the same trade-off as FAR/FRR.

---

## 9. Standards & test frameworks

**ICAO Doc 9303** — the standard for machine-readable travel documents: MRZ structure, the eMRTD chip, and the issuing-country PKI. The passport reference.

**ISO/IEC 18013-5** — the in-person mobile driving licence (mDL) standard.

**ISO/IEC TS 18013-7 (2025)** — online / unattended mDL presentation over the internet. The piece that makes an mDL usable for remote onboarding; early bank flows began appearing late 2025.

**ISO/IEC 30107-3** — presentation attack detection testing. Applies to document PAD as well as selfie liveness.

**NIST SP 800-63-4 (Aug 2025)** — the US digital identity guidelines, finalized after a four-year revision. Part 800-63A covers identity proofing and defines the assurance levels; the revision sharpened IAL/AAL/FAL and pushed continuous, risk-based evaluation.

**NIST FATE MORPH / FRTE** — independent benchmarks for morph detection and face recognition; the neutral yardsticks.

**iBeta / lab testing** — independent conformance testing for PAD and document checks.

**eIDAS assurance levels** — Low / Substantial / High, the EU grading an IDV flow must map to.

**UK DIATF / DVS Trust Framework** — the UK certification scheme for identity and attribute providers (Gamma 0.4 in 2025, formalized as DVS Trust Framework v1.0 in 2026).

---

## 10. Regulation & schemes

**KYC / AML / CDD / EDD** — the obligations that make IDV mandatory (§1).

**FATF** — the global AML standard-setter; its recommendations shape national KYC rules.

**GDPR (UK/EU)** — IDV captures document images and a biometric portrait, so it pulls in lawful basis, data minimization, retention limits, and erasure. The sharp question is what you keep from extraction and for how long.

**Data minimization** — collect and retain only what's needed. An IDV design constraint, not a nicety: storing full document images indefinitely is a liability.

**AMLD (EU) / MLR (UK)** — the legal instruments mandating customer verification.

**PSD2 / SCA** — payments authentication. IDV establishes the identity that SCA later re-authenticates.

**Age verification / assurance** — proving age, often from a document, without over-collecting identity. A growing regulatory area with its own minimization pressure.

**eIDAS 2.0 / EUDI Wallet** — the EU regulation mandating digital identity wallets by December 2026. Its **PID** (Person Identification Data) becomes a reusable, wallet-held identity that can stand in for repeated document IDV.

---

## 11. Mobile & digital credentials

**Mobile Driving Licence** *(mDL)* — a phone-held driving licence (ISO 18013-5/-7), issued by the authority and cryptographically verifiable. Increasingly accepted for KYC, and a different object from a photo of a licence.

**Verifiable Credential** *(VC)* — a tamper-evident, cryptographically signed digital claim; the W3C model behind wallet credentials.

**EUDI Wallet / PID** — the EU wallet and its Person Identification Data: a reusable verified identity that can replace repeat document checks.

**Selective disclosure** — revealing only the needed attribute ("over 18") from a credential rather than the whole document. The privacy advantage of credentials over document scans.

**ICAO Digital Travel Credential** *(DTC)* — a digital version of the passport; the travel analog of the mDL.

**The shift this implies** — IDV moves from "verify a document image" toward "verify a signed credential the user already holds." Document IDV doesn't disappear; it becomes the bootstrap that issues those credentials.

---

## 12. The AI layer for IDV

**VLM for extraction** — vision models read fields, MRZ, and layout with strong zero-shot, multilingual performance. The one place in the identity pipeline where a generalist plausibly beats the specialist OCR.

**VLM for classification** — identifying document type and country by reasoning over layout, without a per-template model.

**LLM/VLM-as-judge for authenticity** — using a model to reason about visual inconsistencies (font, alignment, photo edges). Catches obvious tampering, misses good forgeries, the same pattern as selfie liveness.

**Hallucination in extraction** — a model confidently inventing a field value that isn't on the document. A correctness and compliance risk specific to document AI, and a reason raw VLM output can't be trusted unchecked.

**Confidence & calibration** — extraction and authenticity confidence is only trustworthy once measured (ECE). A stated 0.9 is a claim until you've checked it's right 90% of the time.

**Human-in-the-loop** — routing low-confidence or high-risk cases to manual review. The governance backbone of AI-driven IDV.

**Data lineage & PII minimization** — tracking what was extracted, where it flows, and what's deleted. The IDV-specific governance burden, because extraction manufactures real PII that didn't exist as structured data before.

**Cost per verification** — the loaded cost of a document check including VLM tokens, and a document image is a lot of input tokens. The economics that decide whether the model runs on every document or only the hard ones.

---

## 13. Market & vendors (reference)

Named for orientation, architecture-first, not endorsements.

| Vendor | Note |
|---|---|
| **Onfido (Entrust)** | IDV + biometric, strong UK banking presence |
| **Jumio** | IDV + AML suite |
| **Mitek** | document capture (MiSnap) + IDV |
| **Veriff / IDnow / Incode / Persona / Au10tix** | IDV platforms across markets |
| **Regula** | document forensics / authenticity specialist |
| **iProov / FaceTec** | liveness specialists paired with IDV |

---

## 14. Quick disambiguations (the ones people get wrong)

- **Verification ≠ authentication.** Is this identity real and theirs (onboarding) vs is this the same person back (login).
- **Proofing ≠ verification.** Proofing is the whole identity-establishing process; document verification is one part of it.
- **Counterfeit ≠ forgery ≠ fantasy document.** Wholesale fake vs altered genuine vs invented authority.
- **Document liveness ≠ selfie liveness.** Is the document real and present vs is the face real and present.
- **Presentation attack ≠ injection attack.** Fake shown to the camera vs image fed past the camera.
- **OCR ≠ MRZ parsing.** Free-text reading vs structured, check-digit-validated reading.
- **Photo substitution ≠ morphing.** Swapping the portrait vs blending two faces into one that matches both.
- **APCER (documents) ≠ FAR.** Forged-accepted-as-genuine vs impostor-accepted in matching.
- **An mDL ≠ a photo of a licence.** A signed, verifiable credential vs an image to OCR.
