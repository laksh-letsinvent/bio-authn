# Build Prompt — bio-authN Phase 3 (Live Flow)

> Paste into a coding agent after Phase 1, Phase 2, and v2. Read `CLAUDE.md`, `CONTEXT.md`, and `DECISIONS.md` first. Phase 3 is the live selfie flow: a real camera, in-browser liveness, enrollment, and step-up. It **reuses the frozen engine and contracts unchanged** and runs **local or private VM only** (D9), never a wide-open public URL. This is the capstone demo, not a production auth system.

---

## 0. What Phase 3 is

The first part of the project a person can actually use. A browser opens the camera, runs an active liveness challenge, captures a frame, and the backend enrolls or verifies the face using the same ArcFace adapter the eval harness uses. Where the matcher is unsure, it can ask the VLM for a second opinion, the exact pattern the eval measured. Every decision is logged as an evidence record.

The point: take the engine that's been measured to death and make it move, so the eval, cost, and governance ideas become tangible.

## 1. Scope

**In:** a React + TypeScript app (camera, MediaPipe liveness, enroll + step-up UI), a FastAPI backend exposing `/enroll` and `/step-up`, a SQLite store for users and auth events, the uncertain-band VLM second opinion (cost-gated), reuse of the Face Value design tokens, and a "Try it live" entry from the portal.

**Out (do not build):**
- No production hardening, no real account system, no password/email — a demo identity is just a name you type.
- No wide public deployment. Local or private VM. No PII leaves the machine.
- No real liveness vendor. MediaPipe active challenge only — it defeats a photo or static replay, not a deepfake or a 3D mask. Say so in the UI.
- No change to the `MatcherAdapter` interface or the result schema.

## 2. Contracts reused (do not re-implement)

- The backend calls the existing `engine/adapters` (ArcFace ONNX for matching; the VLM adapter for the second opinion) through the same `MatcherAdapter.run()` and gets back a `MatchResult`. The live flow is a new caller of the engine, not a fork of it.
- The accept/reject threshold and the uncertain band come from the eval run (`results/eval_run.json`): operating threshold ≈ 0.298, band ≈ [0.23, 0.37]. Load them, don't hardcode a second copy.
- Reuse `portal/styles/tokens.css` for theme so the live app matches Face Value (dark default + light switcher).

## 3. The two flows

### Enrollment
1. User types a display name and opens the camera.
2. Active liveness challenge runs in the browser (random sequence: blink twice, turn head left/right).
3. On pass, capture one clean frame.
4. POST the frame to `/enroll`.
5. Backend extracts the ArcFace embedding and stores it against the name in SQLite. The raw image is kept only if `RESEARCH_MODE` is on (local only); otherwise it's discarded after embedding.
6. Return `{ enrolled: true }`.

### Step-up
1. App triggers step-up on a sensitive action (view account number, confirm a payment, change credentials) — a demo button.
2. Camera modal opens, same liveness challenge.
3. On pass, capture the probe frame and POST it with the user id to `/step-up`.
4. Backend extracts the probe embedding, cosine-compares to the stored one, applies the eval threshold → `{ verified, score }`.
5. If the score lands in the uncertain band and `VLM_SECOND_OPINION` is on, call the VLM with the probe and the reference image, attach its `{ decision, confidence, reasoning, cost_usd, latency_ms }`.
6. Log the whole event (below) and return the combined result to the UI, including the VLM's reasoning when present.

## 4. Liveness (frontend, MediaPipe)

Active liveness via MediaPipe Face Mesh, in-browser (WASM), no server round-trip.
- 468 3D landmarks per frame. Blink detection via Eye Aspect Ratio (EAR drops ~0.25 → <0.1 on a blink). Head turn via yaw from landmark geometry, crossing ±15°.
- Random 2 to 3 step challenge per session, so a photo or a recording can't answer.
- Defends against print, static screen replay, and photo-hold. Does NOT defend against good video replay, deepfakes, or 3D masks. Put that limit in the UI, don't hide it.

## 5. Backend API (FastAPI)

- `POST /enroll` → `{ name, image }` → embed, store, `{ enrolled, user_id }`.
- `POST /step-up` → `{ user_id, image }` → match, optional VLM, log, `{ verified, score, threshold, vlm? }`.
- `GET /events` → recent auth events for the governance view (local only).
- Reuses `engine/` for all matching. The only new code is the routes, the SQLite layer, and the request/response shapes.

## 6. Data model & privacy

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY, name TEXT, enrolled_at DATETIME,
  embedding BLOB,                 -- ArcFace 512-d
  ref_image BLOB,                 -- only when RESEARCH_MODE=1; else NULL
  research_only INTEGER DEFAULT 1
);
CREATE TABLE auth_events (
  id TEXT PRIMARY KEY, user_id TEXT, event_type TEXT,   -- 'enroll' | 'step_up'
  liveness_passed INTEGER, arcface_score REAL, arcface_verified INTEGER,
  threshold REAL, in_uncertain_band INTEGER,
  vlm_decision TEXT, vlm_confidence REAL, vlm_reasoning TEXT,
  vlm_cost_usd REAL, latency_ms INTEGER, created_at DATETIME
);
```

Privacy: self-capture is ephemeral. In demo mode the image is embedded and dropped, never written. `RESEARCH_MODE` (local only) keeps the reference image so you can inspect it. No image ever leaves the machine except, if `VLM_SECOND_OPINION` is on, the probe + reference go to the VLM transport you configured — flag that in the UI.

## 7. Frontend (React + TS)

- Components: `CameraCapture` (react-webcam), `LivenessChallenge` (MediaPipe loop, EAR + yaw), `EnrollModal`, `StepUpModal`, `EventLog` (the audit view).
- Styling: import `tokens.css`; match the portal — dark default, light switcher, the same accent and semantic colours (accept green, uncertain amber, reject red on the result).
- Show the decision honestly: the score, where it fell against the threshold and band, the liveness result, and the VLM's reasoning when it was consulted. This is the governance idea made visible.

## 8. The VLM second opinion (cost-gated)

Off by default, because each call is ~$0.05 and ~10s (the eval measured this). When on, it fires only for scores inside the uncertain band, never on the hot path. Surface its cost and latency in the result so the economics stay visible. This is the live version of the eval's headline finding.

## 9. Governance / audit

`auth_events` is the evidence log. Each row answers "why did this decision happen": liveness result, matcher score, the threshold applied, whether it hit the band, and the VLM's reasoning and cost when consulted. The `EventLog` view renders it. This is the audit-log and per-decision-explainability pillar, running for real instead of described.

## 10. Config & deps

```
RESEARCH_MODE=0            # 1 keeps reference images (local only)
VLM_SECOND_OPINION=0       # 1 enables band-gated VLM calls
VLM_MODE=cli               # local | api | cli  (reuse engine transports)
```
Frontend: react, typescript, react-webcam, @mediapipe/face_mesh, @mediapipe/camera_utils, vite. Backend: fastapi, uvicorn (reuse existing engine deps).

## 11. Build order & acceptance

1. Backend routes over the existing engine: `/enroll`, `/step-up`, `/events`, SQLite layer.
2. Liveness component (MediaPipe EAR + yaw + random challenge) proven in isolation.
3. Enroll flow end to end (capture → embed → store).
4. Step-up flow (capture → match → threshold → result), then the band-gated VLM second opinion.
5. Event log view + theme from `tokens.css`.
6. "Try it live" entry wired from the portal (enable the disabled nav slot).

**Acceptance:** a person can enroll a face and then pass or fail a step-up, all locally; liveness rejects a held-up photo; the result shows score, threshold, band, and liveness honestly; the VLM second opinion fires only inside the band and only when enabled, with its cost shown; every action lands in `auth_events` and renders in the log; no image is written when `RESEARCH_MODE=0`; the engine and result schema are unchanged; nothing is exposed beyond localhost / the private VM.

## 12. Non-goals recap

Not production auth, not a real account system, not a public URL, not deepfake-grade liveness. Phase 3 makes the measured engine tangible and renders the governance and cost ideas as something you can click. The honesty about what it doesn't defend is part of the demo.

## 13. Portal hook

Flip the portal's disabled "Try it live" nav item to a link to the running live app (local/VM address). Keep it clearly marked as the local demo, not a hosted service.
