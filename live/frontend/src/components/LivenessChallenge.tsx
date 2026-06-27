import { useCallback, useEffect, useRef, useState } from 'react';
import Webcam from 'react-webcam';
import type { ChallengeStep, StepStatus } from '../types';

/* MediaPipe loaded via CDN in index.html */
declare global {
  interface Window { FaceMesh: any }
}

interface Props {
  onComplete: (imageDataUrl: string) => void;
  onFail: (reason: string) => void;
}

const STEP_LABELS: Record<ChallengeStep, string> = {
  blink:      'Blink once',
  turn_left:  'Look to your left',
  turn_right: 'Look to your right',
};

/* MediaPipe landmark indices */
const L_EYE = [33, 160, 158, 133, 153, 144];
const R_EYE = [362, 385, 387, 263, 373, 380];

const EAR_CLOSE = 0.20;  // EAR threshold for eye-closed (raised: natural blinks often don't drop below 0.15)
const EAR_OPEN  = 0.26;  // EAR threshold for eye-reopened
const TURN_THR  = 0.07;  // nose offset / face-width to call a turn
const TURN_HOLD = 4;     // frames nose must stay past threshold (~130ms at 30fps)
const FPS_TARGET = 30;   // throttle MediaPipe sends to avoid pipeline congestion

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function ear(lm: any[], idx: number[]): number {
  const p = idx.map(i => lm[i]);
  return (dist(p[1], p[5]) + dist(p[2], p[4])) / (2 * dist(p[0], p[3]));
}

function randomChallenge(): ChallengeStep[] {
  // Always: one blink + one turn. 50% chance of a third step.
  const turn: ChallengeStep = Math.random() < 0.5 ? 'turn_left' : 'turn_right';
  const steps: ChallengeStep[] = ['blink', turn];
  if (Math.random() < 0.5) {
    const extras: ChallengeStep[] = ['blink', turn === 'turn_left' ? 'turn_right' : 'turn_left'];
    steps.push(extras[Math.floor(Math.random() * extras.length)]);
  }
  return steps;
}

export function LivenessChallenge({ onComplete, onFail }: Props) {
  const webcamRef = useRef<Webcam>(null);
  const faceMeshRef = useRef<any>(null);
  const rafRef = useRef<number>(0);
  const capturedRef = useRef(false);
  const lastSendRef = useRef(0);

  // Challenge state kept in refs so RAF closure always sees latest values
  const stepsRef    = useRef<ChallengeStep[]>(randomChallenge());
  const currentRef  = useRef(0);
  const statusRef   = useRef<StepStatus[]>(stepsRef.current.map((_, i) => i === 0 ? 'active' : 'pending'));
  const blinkRef    = useRef<'open' | 'closing'>('open');
  const turnHoldRef = useRef(0);

  const [ui, setUi] = useState({
    steps: stepsRef.current,
    current: 0,
    status: [...statusRef.current] as StepStatus[],
  });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const capture = useCallback(() => {
    if (capturedRef.current) return;
    capturedRef.current = true;
    const url = webcamRef.current?.getScreenshot();
    if (url) onComplete(url);
    else onFail('Failed to capture frame from webcam.');
  }, [onComplete, onFail]);

  const advanceStep = useCallback(() => {
    statusRef.current[currentRef.current] = 'done';
    const next = currentRef.current + 1;
    if (next >= stepsRef.current.length) {
      setUi({ steps: stepsRef.current, current: next, status: [...statusRef.current] });
      setTimeout(capture, 350);
    } else {
      currentRef.current = next;
      statusRef.current[next] = 'active';
      blinkRef.current = 'open';
      turnHoldRef.current = 0;
      setUi({ steps: stepsRef.current, current: next, status: [...statusRef.current] });
    }
  }, [capture]);

  const onResults = useCallback((results: any) => {
    if (!results.multiFaceLandmarks?.length) return;
    const lm = results.multiFaceLandmarks[0];
    const step = stepsRef.current[currentRef.current];
    if (!step) return;

    if (step === 'blink') {
      const avg = (ear(lm, L_EYE) + ear(lm, R_EYE)) / 2;
      if (avg < EAR_CLOSE && blinkRef.current === 'open') {
        blinkRef.current = 'closing';
      } else if (avg > EAR_OPEN && blinkRef.current === 'closing') {
        blinkRef.current = 'open';
        advanceStep();
      }
    } else {
      // turn_left / turn_right
      // Video is mirrored in the display; raw coords: turn_left (face-left) → nose shifts right (higher x)
      const nose      = lm[1];
      const eyeCenterX = (lm[33].x + lm[263].x) / 2;
      const faceWidth  = Math.abs(lm[263].x - lm[33].x) || 0.001;
      const offset     = (nose.x - eyeCenterX) / faceWidth;
      const turned =
        step === 'turn_left'  ? offset >  TURN_THR :
        step === 'turn_right' ? offset < -TURN_THR : false;

      turnHoldRef.current = turned ? turnHoldRef.current + 1 : 0;
      if (turnHoldRef.current >= TURN_HOLD) {
        turnHoldRef.current = 0;
        advanceStep();
      }
    }
  }, [advanceStep]);

  useEffect(() => {
    if (!window.FaceMesh) {
      setError('MediaPipe FaceMesh not loaded. Check your internet connection and reload.');
      return;
    }
    const fm = new window.FaceMesh({
      locateFile: (f: string) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${f}`,
    });
    fm.setOptions({
      maxNumFaces: 1,
      refineLandmarks: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    fm.onResults(onResults);
    faceMeshRef.current = fm;

    let active = true;
    const interval = 1000 / FPS_TARGET;
    const loop = async (now: number) => {
      if (!active) return;
      const video = webcamRef.current?.video;
      if (video && video.readyState === 4 && now - lastSendRef.current >= interval) {
        lastSendRef.current = now;
        try { await fm.send({ image: video }); } catch (_) {}
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    // Short delay so webcam stream is live before first send
    const timer = setTimeout(() => {
      setReady(true);
      rafRef.current = requestAnimationFrame(loop);
    }, 400);

    return () => {
      active = false;
      clearTimeout(timer);
      cancelAnimationFrame(rafRef.current);
      fm.close?.();
    };
  }, [onResults]);

  if (error) return <div className="liveness-error">{error}</div>;

  const allDone = ui.current >= ui.steps.length;

  return (
    <div className="liveness-wrap">
      <div className="liveness-video-wrap">
        <Webcam
          ref={webcamRef}
          audio={false}
          screenshotFormat="image/jpeg"
          videoConstraints={{ facingMode: 'user', width: 480, height: 360 }}
          mirrored
          className="liveness-video"
        />
        {!ready && <div className="liveness-overlay-msg">Starting camera…</div>}
        {allDone && <div className="liveness-overlay-msg liveness-overlay-msg--done">✓</div>}
      </div>

      <div className="liveness-steps">
        {ui.steps.map((step, i) => (
          <div key={i} className={`liveness-step liveness-step--${ui.status[i] ?? 'pending'}`}>
            <span className="liveness-step__icon">
              {ui.status[i] === 'done' ? '✓' : i + 1}
            </span>
            {STEP_LABELS[step]}
          </div>
        ))}
      </div>

      {!allDone && ready && (
        <p className="liveness-cue">{STEP_LABELS[ui.steps[ui.current]]}</p>
      )}
    </div>
  );
}
