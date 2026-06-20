# Bio-authN — Project Context

> Prototype: selfie-based biometric authentication with dual matching paths.
> Status: Pre-build. Use this file to orient any new session or collaborator.

---

## What this is

A learning prototype that implements selfie-based step-up authentication using **Option B**: two parallel matching paths run on every auth event.

- **Production path** — template-to-template (ArcFace embedding vs ArcFace embedding). Privacy-correct, fast, no image retrieval at auth time.
- **Research path** — image-to-image (reference image vs probe image, sent to vision LLMs). Enables benchmarking LLMs against specialist models. Would not exist in a real deployment.

The research question: *where do frontier vision LLMs (Claude, GPT-4o) add value in a biometric pipeline, and where do they not?*

---

## The two auth flows

### Enrollment (registration)

1. User opens camera in browser
2. Frontend runs **active liveness challenge** (random sequence: blink twice, turn head left)
3. On liveness pass: capture one clean frame
4. POST image to backend
5. Backend:
   - Runs ArcFace → extracts 512-d embedding → stores in SQLite
   - Stores reference image in SQLite, flagged `research_only = true`
   - Discards nothing in prototype; in production only embedding survives
6. Return `enrolled: true`

### Step-up auth

1. App triggers step-up on sensitive action (view account number, confirm payment, change credentials)
2. Camera modal opens — same liveness challenge
3. On liveness pass: capture probe frame
4. POST probe image + `user_id` to backend
5. Backend runs both paths in parallel:
   - **Path A** (production): ArcFace → probe embedding → cosine similarity vs stored embedding → `{verified, distance}`
   - **Path B** (research): retrieve reference image → send both images to Claude Vision, GPT-4o, AWS Rekognition → `{decision, confidence, reasoning}`
6. Log all results to `auth_events`
7. Return combined response to frontend

---

## Liveness (frontend)

**Method**: Active liveness via **MediaPipe Face Mesh** — runs in-browser (WASM), no server round-trip.

**How it works**:
- MediaPipe gives 468 3D face landmarks per frame in real-time
- **Blink detection**: compute EAR (Eye Aspect Ratio) from 6 eye landmark points. EAR drops from ~0.25 to <0.1 on a real blink. Count frames below threshold.
- **Head turn detection**: head pose (yaw) derived directly from 3D landmark geometry. Check yaw crosses ±15°.
- Generate a random 2–3 step challenge sequence per session. A photo or screen replay cannot respond to random challenges.

**What it defends against**: print attacks, static screen replay, photo-hold attacks.

**What it does not defend against**: high-quality video replay, 3D mask attacks. Acceptable for prototype; production needs dedicated liveness vendor (iProov, FaceTec).

**Optional passive layer**: send captured frame to Claude Vision with liveness assessment prompt. Treat as additional signal, not gate. LLMs catch obvious attacks (visible bezel, moiré, low-res print); fail on good attacks.

---

## Tech stack

### Frontend
```
React + TypeScript
react-webcam          — camera access (WebRTC wrapper)
@mediapipe/face_mesh  — liveness (WASM, in-browser)
@mediapipe/camera_utils
```

### Backend
```
Python 3.11+
fastapi + uvicorn     — API server
deepface              — ArcFace embedding extraction (primary)
insightface           — alternative/comparison model (Buffalo_L)
anthropic             — Claude Vision (research path)
openai                — GPT-4o Vision (research path)
boto3                 — AWS Rekognition (research path)
numpy                 — embedding storage + cosine similarity
pillow                — image handling
sqlite3               — user registry + audit log
```

### Eval harness
```
Python script: eval/benchmark.py
Input: test corpus of image pairs (genuine + impostor)
Output: FRR / FAR / latency / cost per decision for each matcher
```

---

## Data model (SQLite)

```sql
CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  enrolled_at DATETIME,
  embedding   BLOB,              -- ArcFace 512-d float array, numpy tobytes()
  ref_image   BLOB,              -- raw JPEG bytes, research only
  research_only INTEGER DEFAULT 1  -- flag: would not exist in production
);

CREATE TABLE auth_events (
  id                TEXT PRIMARY KEY,
  user_id           TEXT,
  event_type        TEXT,        -- 'enrollment' | 'step_up'
  liveness_passed   INTEGER,
  -- Path A: production
  arcface_distance  REAL,
  arcface_verified  INTEGER,
  -- Path B: research
  claude_decision   TEXT,
  claude_confidence REAL,
  claude_reasoning  TEXT,
  gpt4o_decision    TEXT,
  gpt4o_confidence  REAL,
  rekognition_sim   REAL,
  rekognition_verified INTEGER,
  -- Meta
  latency_arcface_ms   INTEGER,
  latency_claude_ms    INTEGER,
  latency_gpt4o_ms     INTEGER,
  latency_rekognition_ms INTEGER,
  created_at        DATETIME
);
```

---

## Repo structure

```
bio-authn/
├── CONTEXT.md              ← this file
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── LivenessChallenge.tsx   — MediaPipe loop, EAR blink, head turn
│   │   │   ├── CameraCapture.tsx       — react-webcam wrapper
│   │   │   └── AuthModal.tsx           — step-up trigger UI
│   │   └── App.tsx
│   └── package.json
├── backend/
│   ├── main.py             — FastAPI routes: /enroll, /step-up
│   ├── matcher.py          — ArcFace + LLM + Rekognition matching logic
│   ├── liveness.py         — optional passive liveness prompt (Claude)
│   └── db.py               — SQLite schema + helpers
├── eval/
│   └── benchmark.py        — test corpus runner, outputs FRR/FAR/latency table
├── data/
│   └── synthetic/          — synthetic face pairs for eval (no real PII)
└── README.md
```

---

## Matching matchers at a glance

| Matcher | Path | Latency (est.) | Cost | What it tells you |
|---|---|---|---|---|
| ArcFace (DeepFace) | Production | <200ms local | Free | Ground truth — production-grade biometric |
| InsightFace (Buffalo_L) | Production alt | <200ms local | Free | SOTA open model comparison |
| Claude Vision | Research | 600–1000ms | ~$0.01/call | Reasoning quality, explainability |
| GPT-4o Vision | Research | 500–900ms | ~$0.01/call | Second LLM comparison point |
| AWS Rekognition | Research | 200–400ms | ~$0.001/call | Cloud production baseline |

---

## The writeup angle (what this prototype earns)

Blog post: *"I benchmarked Claude Vision against ArcFace on selfie face-matching. Here's where vision LLMs fit in a biometric pipeline — and where they don't."*

Key findings to surface from the eval:
1. ArcFace: fast, deterministic, production-ready — the matcher LLMs should be judged against
2. Vision LLMs: good at *explaining* why a match is uncertain ("lighting differs, angle ~30° off"), poor at *deciding* reliably when inputs are ambiguous
3. LLM sweet spot: second-opinion layer when ArcFace distance lands in the uncertain band (~0.55–0.75), not the primary gate
4. Passive liveness via LLM: catches obvious attacks, misses good ones — useful signal layer, not a gate
5. The production pattern (template-to-template) architecturally excludes LLMs from the matching step — they need images, not embeddings. That's a structural observation about where LLMs can and can't sit in a biometric pipeline.

---

## Open decisions (resolve before building)

- [ ] ArcFace threshold to use (default 0.68 cosine; tune on synthetic corpus)
- [ ] Liveness challenge sequence length (2 or 3 steps; 3 is more robust, slower UX)
- [ ] Whether to add InsightFace alongside DeepFace or just use one
- [ ] AWS Rekognition: include or skip for v1 (adds AWS setup cost/complexity)
- [ ] Test corpus: use SIDTD (public IDV dataset) or generate synthetic pairs only
- [ ] Streamlit vs React for frontend (Streamlit = faster to ship, worse liveness integration; React = correct choice for WebRTC/MediaPipe)

---

## What this prototype is not

- Not a production biometric system
- Not FIDO2 / WebAuthn (device-bound, private key — different pattern entirely)
- Not sMPC / Keyless (distributed template — different trust model)
- The reference image storage is a research affordance explicitly, not a design decision

---

## Related context

- Lives alongside the AI_PM_Career2027 project as prototype P2 (IDV with Vision Models)
- The face-matching pipeline built here feeds directly into P2's fuller IDV flow (passport + selfie)
- The governance patterns (audit log, model routing) connect to P5 (Thin-File Review Workflow Agent)
