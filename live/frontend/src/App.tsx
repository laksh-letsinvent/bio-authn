import { useState, useEffect, useCallback } from 'react';
import { EnrollModal } from './components/EnrollModal';
import { StepUpModal } from './components/StepUpModal';
import { EventLog } from './components/EventLog';
import type { StepUpResult, User } from './types';
import * as api from './api';

type View = 'demo' | 'log';

export default function App() {
  const [view, setView] = useState<View>('demo');
  const [users, setUsers] = useState<User[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [showEnroll, setShowEnroll] = useState(false);
  const [showStepUp, setShowStepUp] = useState(false);
  const [lastResult, setLastResult] = useState<StepUpResult | null>(null);

  const refreshUsers = useCallback(async () => {
    const list = await api.getUsers();
    setUsers(list);
    if (list.length && !selectedId) setSelectedId(list[0].id);
  }, [selectedId]);

  useEffect(() => { refreshUsers(); }, []);

  const selectedUser = users.find(u => u.id === selectedId) ?? null;

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header__brand">
          <span className="app-header__logo">bio-authN</span>
          <span className="app-header__tag">live demo</span>
        </div>
        <nav className="app-nav">
          <button
            className={`nav-btn${view === 'demo' ? ' nav-btn--active' : ''}`}
            onClick={() => setView('demo')}
          >Demo</button>
          <button
            className={`nav-btn${view === 'log' ? ' nav-btn--active' : ''}`}
            onClick={() => setView('log')}
          >Audit log</button>
          <a
            className="nav-btn"
            href="http://localhost:8000/docs"
            target="_blank"
            rel="noreferrer"
          >API docs ↗</a>
        </nav>
      </header>

      <main className="app-main">
        {view === 'demo' && (
          <div className="demo-grid">
            {/* Enrolment card */}
            <section className="card">
              <h2 className="card__title">Enrol a new identity</h2>
              <p className="card__desc">
                Pass a short active liveness challenge. Your face embedding is stored
                locally in SQLite. No image is kept unless <code>RESEARCH_MODE=1</code>.
              </p>
              <button className="btn btn--primary" onClick={() => setShowEnroll(true)}>
                Start enrolment
              </button>
              {users.length > 0 && (
                <p className="card__hint">{users.length} identity enrolled</p>
              )}
            </section>

            {/* Step-up card */}
            <section className="card">
              <h2 className="card__title">Step-up authentication</h2>
              <p className="card__desc">
                Simulates a sensitive action (view account number, confirm payment)
                that triggers a re-verification challenge.
              </p>

              {users.length === 0 ? (
                <p className="hint">No identities enrolled yet — enrol first.</p>
              ) : (
                <div className="step-up-controls">
                  <select
                    className="user-select"
                    value={selectedId}
                    onChange={e => { setSelectedId(e.target.value); setLastResult(null); }}
                  >
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                  <button
                    className="btn btn--primary"
                    disabled={!selectedUser}
                    onClick={() => { setLastResult(null); setShowStepUp(true); }}
                  >
                    Trigger step-up
                  </button>
                </div>
              )}

              {lastResult && (
                <div className={`inline-result inline-result--${lastResult.verified ? 'accept' : 'reject'}`}>
                  <strong>{lastResult.verified ? '✓ Verified' : '✗ Rejected'}</strong>
                  {' · '}score {lastResult.score.toFixed(4)} vs thr {lastResult.threshold.toFixed(4)}
                  {lastResult.in_uncertain_band && (
                    <span className="amber-tag"> · uncertain band</span>
                  )}
                </div>
              )}
            </section>

            {/* Caveat card */}
            <section className="card card--caveat">
              <h3 className="card__title">What the liveness check defends against</h3>
              <ul className="caveat-list">
                <li className="caveat-list__item caveat-list__item--yes">Printed photo held to camera</li>
                <li className="caveat-list__item caveat-list__item--yes">Static screen replay</li>
                <li className="caveat-list__item caveat-list__item--no">Good video replay</li>
                <li className="caveat-list__item caveat-list__item--no">Deepfakes or 3-D masks</li>
              </ul>
              <p className="card__desc">
                Active liveness via MediaPipe Face Mesh (blink + head turn). Not iBeta-grade.
                The uncertain-band VLM second opinion is available but off by default — enable
                with <code>VLM_SECOND_OPINION=1</code>.
              </p>
            </section>
          </div>
        )}

        {view === 'log' && <EventLog />}
      </main>

      {showEnroll && (
        <EnrollModal
          onClose={() => setShowEnroll(false)}
          onEnrolled={(uid) => {
            setShowEnroll(false);
            refreshUsers().then(() => setSelectedId(uid));
          }}
        />
      )}

      {showStepUp && selectedUser && (
        <StepUpModal
          user={selectedUser}
          onClose={() => setShowStepUp(false)}
          onResult={r => { setLastResult(r); setShowStepUp(false); }}
        />
      )}
    </div>
  );
}
