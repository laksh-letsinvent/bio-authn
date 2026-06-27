import { useEffect, useState } from 'react';
import type { AuthEvent } from '../types';
import * as api from '../api';

export function EventLog() {
  const [events, setEvents] = useState<AuthEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      setEvents(await api.getEvents());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, []);

  if (loading) return <p className="status-msg">Loading…</p>;

  return (
    <div className="event-log">
      <div className="event-log__header">
        <h2>Audit log</h2>
        <button className="btn btn--sm" onClick={refresh}>Refresh</button>
      </div>

      {events.length === 0 ? (
        <p className="hint">No events yet. Enrol a face and trigger a step-up.</p>
      ) : (
        <table className="event-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>User</th>
              <th>Event</th>
              <th>Liveness</th>
              <th>Score</th>
              <th>Threshold</th>
              <th>Band</th>
              <th>Outcome</th>
              <th>ms</th>
            </tr>
          </thead>
          <tbody>
            {events.map(e => {
              const time = new Date(e.created_at).toLocaleTimeString();
              const outcome =
                e.arcface_verified === null ? '—'
                : e.arcface_verified        ? 'Accept'
                :                             'Reject';
              const outcomeClass =
                e.arcface_verified === null ? ''
                : e.arcface_verified        ? 'accept'
                :                             'reject';
              return (
                <tr key={e.id}>
                  <td className="mono">{time}</td>
                  <td>{e.user_name ?? '—'}</td>
                  <td><span className="tag">{e.event_type}</span></td>
                  <td className="center">{e.liveness_passed ? '✓' : '✗'}</td>
                  <td className="mono">{e.arcface_score?.toFixed(4) ?? '—'}</td>
                  <td className="mono">{e.threshold?.toFixed(4) ?? '—'}</td>
                  <td className="center">
                    {e.in_uncertain_band === null ? '—'
                      : e.in_uncertain_band ? <span className="amber">yes</span>
                      : 'no'}
                  </td>
                  <td>
                    {outcome !== '—'
                      ? <span className={`verdict verdict--${outcomeClass}`}>{outcome}</span>
                      : '—'}
                  </td>
                  <td className="mono">{e.latency_ms ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p className="event-log__footnote">
        Each row answers: who, what liveness steps they completed, the ArcFace cosine
        score vs the eval-tuned threshold, whether the score hit the uncertain band
        [threshold ± 0.07], and the final decision. Auto-refreshes every 5 s.
      </p>
    </div>
  );
}
