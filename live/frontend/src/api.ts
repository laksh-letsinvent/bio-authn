import type { AuthEvent, StepUpResult, User } from './types';

async function _post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

export const enroll = (name: string, image: string, liveness_passed: boolean) =>
  _post<{ user_id: string; name: string }>('/enroll', { name, image, liveness_passed });

export const stepUp = (user_id: string, image: string, liveness_passed: boolean) =>
  _post<StepUpResult>('/step-up', { user_id, image, liveness_passed });

export const getUsers = (): Promise<User[]> =>
  fetch('/users').then(r => r.json());

export const getEvents = (): Promise<AuthEvent[]> =>
  fetch('/events').then(r => r.json());
