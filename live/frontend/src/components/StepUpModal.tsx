import { useState, useCallback } from 'react';
import { LivenessChallenge } from './LivenessChallenge';
import type { StepUpResult, User } from '../types';
import * as api from '../api';

interface Props {
  user: User;
  onClose: () => void;
  onResult: (result: StepUpResult) => void;
}

type Phase = 'liveness' | 'verifying' | 'result' | 'error';

export function StepUpModal({ user, onClose, onResult }: Props) {
  const [phase, setPhase] = useState<Phase>('liveness');
  const [result, setResult] = useState<StepUpResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const handleCapture = useCallback(async (imageUrl: string) => {
    setPhase('verifying');
    try {
      const r = await api.stepUp(user.id, imageUrl, true);
      setResult(r);
      setPhase('result');
      onResult(r);
    } catch (e: any) {
      setErrorMsg(e.message ?? 'Verification failed.');
      setPhase('error');
    }
  }, [user.id, onResult]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--wide" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="modal-title">Step-up — {user.name}</h2>

        {phase === 'liveness' && (
          <LivenessChallenge
            onComplete={handleCapture}
            onFail={msg => { setErrorMsg(msg); setPhase('error'); }}
          />
        )}

        {phase === 'verifying' && (
          <p className="status-msg">Verifying…</p>
        )}

        {phase === 'result' && result && (
          <div className="result-panel">
            <div className={`result-verdict result-verdict--${result.verified ? 'accept' : 'reject'}`}>
              {result.verified ? '✓ Verified' : '✗ Rejected'}
            </div>

            <div className="result-metrics">
              <Metric label="Score"     value={result.score.toFixed(4)} />
              <Metric label="Threshold" value={result.threshold.toFixed(4)} />
              <Metric
                label="Uncertain band"
                value={result.in_uncertain_band
                  ? `Yes  [${result.band[0]} – ${result.band[1]}]`
                  : 'No'}
                highlight={result.in_uncertain_band ? 'amber' : undefined}
              />
              <Metric label="Liveness"  value={result.liveness_passed ? 'Passed ✓' : 'Failed ✗'} />
              <Metric label="Latency"   value={`${result.latency_ms} ms`} />
            </div>

            {result.in_uncertain_band && !result.vlm && (
              <p className="result-note">
                Score inside uncertain band — VLM second opinion is off.
                Set <code>VLM_SECOND_OPINION=1</code> to enable.
              </p>
            )}

            {result.vlm && (
              <div className="vlm-panel">
                <h4>VLM second opinion</h4>
                <Metric label="Decision"   value={result.vlm.decision} />
                <Metric label="Confidence" value={result.vlm.confidence.toFixed(2)} />
                <Metric label="Cost"       value={`$${result.vlm.cost_usd.toFixed(4)}`} />
                <Metric label="Latency"    value={`${result.vlm.latency_ms} ms`} />
                <p className="vlm-reasoning">{result.vlm.reasoning}</p>
              </div>
            )}

            <button className="btn btn--sm" onClick={onClose} style={{ marginTop: '1rem' }}>
              Close
            </button>
          </div>
        )}

        {phase === 'error' && (
          <div className="error-panel">
            <p className="status-msg status-msg--reject">{errorMsg}</p>
            <button className="btn" onClick={() => { setPhase('liveness'); setErrorMsg(''); }}>
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: 'amber' }) {
  return (
    <div className={`result-metric${highlight ? ` result-metric--${highlight}` : ''}`}>
      <span className="result-metric__label">{label}</span>
      <span className="result-metric__value">{value}</span>
    </div>
  );
}
