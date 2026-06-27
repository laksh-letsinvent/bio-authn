export interface User {
  id: string;
  name: string;
  enrolled_at: string;
}

export interface StepUpResult {
  verified: boolean;
  score: number;
  threshold: number;
  band: [number, number];
  in_uncertain_band: boolean;
  liveness_passed: boolean;
  vlm: null | {
    decision: string;
    confidence: number;
    reasoning: string;
    cost_usd: number;
    latency_ms: number;
  };
  latency_ms: number;
}

export interface AuthEvent {
  id: string;
  user_id: string;
  user_name: string | null;
  event_type: 'enroll' | 'step_up';
  liveness_passed: number;
  arcface_score: number | null;
  arcface_verified: number | null;
  threshold: number | null;
  in_uncertain_band: number | null;
  vlm_decision: string | null;
  vlm_confidence: number | null;
  vlm_reasoning: string | null;
  vlm_cost_usd: number | null;
  latency_ms: number | null;
  created_at: string;
}

export type ChallengeStep = 'blink' | 'turn_left' | 'turn_right';
export type StepStatus = 'pending' | 'active' | 'done';
