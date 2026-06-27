import { useState, useCallback } from 'react';
import { LivenessChallenge } from './LivenessChallenge';
import * as api from '../api';

interface Props {
  onClose: () => void;
  onEnrolled: (userId: string, name: string) => void;
}

type Phase = 'name' | 'liveness' | 'enrolling' | 'done' | 'error';

export function EnrollModal({ onClose, onEnrolled }: Props) {
  const [phase, setPhase] = useState<Phase>('name');
  const [name, setName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleCapture = useCallback(async (imageUrl: string) => {
    setPhase('enrolling');
    try {
      const result = await api.enroll(name.trim(), imageUrl, true);
      setPhase('done');
      setTimeout(() => onEnrolled(result.user_id, result.name), 700);
    } catch (e: any) {
      setErrorMsg(e.message ?? 'Enrollment failed.');
      setPhase('error');
    }
  }, [name, onEnrolled]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="modal-title">Enrol your face</h2>

        {phase === 'name' && (
          <form
            className="name-form"
            onSubmit={e => { e.preventDefault(); if (name.trim()) setPhase('liveness'); }}
          >
            <p className="modal-desc">Enter a display name, then complete the liveness challenge.</p>
            <input
              className="name-input"
              type="text"
              placeholder="Your name"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              maxLength={40}
            />
            <button className="btn btn--primary" type="submit" disabled={!name.trim()}>
              Continue →
            </button>
          </form>
        )}

        {phase === 'liveness' && (
          <LivenessChallenge
            onComplete={handleCapture}
            onFail={msg => { setErrorMsg(msg); setPhase('error'); }}
          />
        )}

        {phase === 'enrolling' && (
          <p className="status-msg">Generating embedding…</p>
        )}

        {phase === 'done' && (
          <p className="status-msg status-msg--accept">Enrolled ✓</p>
        )}

        {phase === 'error' && (
          <div className="error-panel">
            <p className="status-msg status-msg--reject">{errorMsg}</p>
            <button className="btn" onClick={() => { setPhase('name'); setErrorMsg(''); }}>
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
