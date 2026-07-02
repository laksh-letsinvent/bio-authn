"use client";
import { useState, useEffect } from "react";
import Image from "next/image";

// ─── Types ────────────────────────────────────────────────────────────────────
type ClassifyResult = {
  adapter: string;
  doc_type: string;
  country: string;
  confidence: number;
  passed: boolean;
};
type ExtractField = {
  name: string;
  vlm: string;
  gt: string;
  match: boolean;
};
type ExtractResult = {
  adapter: string;
  field_accuracy: number;
  fields: ExtractField[];
  passed: boolean;
};
type AuthResult = {
  ela_verdict: string;
  ela_confidence: number;
  vlm_verdict: string;
  vlm_confidence: number;
  threshold: number;
  passed: boolean;
  source_doc_id: string;
};
type FaceMatchResult = {
  adapter: string;
  score: number;
  threshold: number;
  passed: boolean;
  note: string;
  source_pair_id: string;
} | null;
type Example = {
  id: string;
  toggle_label: string;
  doc_image: string;
  card_image: string;
  honesty: string;
  classify: ClassifyResult;
  extract: ExtractResult;
  authenticate: AuthResult;
  face_match: FaceMatchResult;
  decision: string;
  decision_reason: string;
};

// ─── Stage IDs ────────────────────────────────────────────────────────────────
const STAGES = ["classify", "extract", "authenticate", "face_match", "decision"] as const;
type StageId = typeof STAGES[number];

const STAGE_LABELS: Record<StageId, string> = {
  classify: "Classify",
  extract: "Extract",
  authenticate: "Authenticate",
  face_match: "Face Match",
  decision: "Decision",
};

// ─── Utilities ────────────────────────────────────────────────────────────────
const pct = (n: number) => (n * 100).toFixed(0) + "%";
const conf = (n: number) => (n * 100).toFixed(0) + "% conf";

function verdict(passed: boolean) {
  return passed ? "PASS" : "FAIL";
}

// ─── Number line for face match ───────────────────────────────────────────────
function ScoreLine({ score, threshold }: { score: number; threshold: number }) {
  const min = -0.25;
  const max = 0.35;
  const range = max - min;
  const scorePct = Math.max(0, Math.min(100, ((score - min) / range) * 100));
  const threshPct = Math.max(0, Math.min(100, ((threshold - min) / range) * 100));
  const passed = score >= threshold;

  return (
    <div className="mt-3 mb-1">
      <div className="relative h-5 rounded-full overflow-hidden bg-[var(--surface-2)] border border-[var(--border-c)]">
        {/* reject zone */}
        <div
          className="absolute inset-y-0 left-0 bg-red-500/15"
          style={{ width: `${threshPct}%` }}
        />
        {/* accept zone */}
        <div
          className="absolute inset-y-0 right-0 bg-green-500/15"
          style={{ width: `${100 - threshPct}%` }}
        />
        {/* threshold tick */}
        <div
          className="absolute inset-y-0 w-[2px] bg-[var(--accent-c)]"
          style={{ left: `${threshPct}%` }}
        />
        {/* score dot */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-white shadow"
          style={{
            left: `${scorePct}%`,
            background: passed ? "#22c55e" : "#ef4444",
          }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-[var(--text-3)] font-mono mt-1 px-0.5">
        <span>{min.toFixed(2)}</span>
        <span>
          score <span className="font-bold" style={{ color: passed ? "#22c55e" : "#ef4444" }}>{score.toFixed(4)}</span>
          {" · "}
          threshold <span className="text-[var(--accent-c)] font-bold">{threshold.toFixed(4)}</span>
        </span>
        <span>{max.toFixed(2)}</span>
      </div>
    </div>
  );
}

// ─── Stage pipeline rail ──────────────────────────────────────────────────────
function PipelineRail({
  active,
  example,
  onSelect,
}: {
  active: StageId;
  example: Example;
  onSelect: (s: StageId) => void;
}) {
  const stageStatus = (s: StageId): "active" | "done" | "skip" | "pending" => {
    const idx = STAGES.indexOf(s);
    const activeIdx = STAGES.indexOf(active);
    if (s === active) return "active";
    if (idx < activeIdx) return "done";
    // face_match is null for forged → skip
    if (s === "face_match" && example.face_match === null) return "skip";
    return "pending";
  };

  return (
    <div className="flex items-center gap-0 w-full mb-6 overflow-x-auto">
      {STAGES.map((s, i) => {
        const status = stageStatus(s);
        const isLast = i === STAGES.length - 1;
        return (
          <div key={s} className="flex items-center min-w-0 flex-1">
            <button
              onClick={() => onSelect(s)}
              className={`flex flex-col items-center gap-1 px-2 py-1.5 rounded-lg transition-all flex-1 ${
                status === "active"
                  ? "bg-[var(--primary-wash)] border border-[var(--accent-c)]/40"
                  : status === "done"
                  ? "hover:bg-[var(--surface-2)]"
                  : status === "skip"
                  ? "opacity-30 cursor-default"
                  : "hover:bg-[var(--surface-2)] opacity-50"
              }`}
              disabled={status === "skip"}
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                  status === "active"
                    ? "border-[var(--accent-c)] text-[var(--accent-c)] bg-[var(--info-zone)]"
                    : status === "done"
                    ? "border-green-500 text-green-500 bg-green-500/10"
                    : status === "skip"
                    ? "border-[var(--border-c)] text-[var(--text-3)]"
                    : "border-[var(--border-c)] text-[var(--text-3)]"
                }`}
              >
                {status === "done" ? "✓" : i + 1}
              </div>
              <span
                className={`text-[10px] font-semibold whitespace-nowrap ${
                  status === "active" ? "text-[var(--accent-c)]" : "text-[var(--text-3)]"
                }`}
              >
                {STAGE_LABELS[s]}
              </span>
            </button>
            {!isLast && (
              <div
                className={`h-[2px] w-4 shrink-0 transition-colors ${
                  stageStatus(STAGES[i + 1]) === "done" || status === "done" || status === "active"
                    ? "bg-[var(--accent-c)]/40"
                    : "bg-[var(--border-c)]"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Stage detail panels ──────────────────────────────────────────────────────
function ClassifyPanel({ data }: { data: ClassifyResult }) {
  return (
    <div className="space-y-4">
      <div className="text-xs text-[var(--text-3)] font-mono mb-2">adapter: {data.adapter}</div>
      <div className="grid grid-cols-2 gap-3">
        <KpiCard label="Document type" value={data.doc_type} />
        <KpiCard label="Country" value={data.country} />
        <KpiCard label="Confidence" value={conf(data.confidence)} />
        <KpiCard
          label="Stage verdict"
          value={verdict(data.passed)}
          color={data.passed ? "#22c55e" : "#ef4444"}
        />
      </div>
      <div className="text-xs text-[var(--text-3)] leading-relaxed pt-1">
        VLM reads the document layout — card dimensions, flag/crest position, field arrangement — to identify type and issuing country before any field extraction.
      </div>
    </div>
  );
}

function ExtractPanel({ data }: { data: ExtractResult }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-[var(--text-3)] font-mono">adapter: {data.adapter}</div>
        <div className="text-xs font-mono">
          field accuracy:{" "}
          <span
            className="font-bold"
            style={{ color: data.field_accuracy === 1 ? "#22c55e" : "#f59e0b" }}
          >
            {pct(data.field_accuracy)}
          </span>
        </div>
      </div>
      <div className="rounded-xl border border-[var(--border-c)] overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[var(--surface-2)] text-[var(--text-3)]">
              <th className="text-left px-3 py-2 font-medium">Field</th>
              <th className="text-left px-3 py-2 font-medium">VLM read</th>
              <th className="text-left px-3 py-2 font-medium">Ground truth</th>
              <th className="text-center px-3 py-2 font-medium">Match</th>
            </tr>
          </thead>
          <tbody>
            {data.fields.map((f, i) => (
              <tr
                key={f.name}
                className={`border-t border-[var(--border-c)] ${i % 2 === 0 ? "" : "bg-[var(--surface-2)]/30"}`}
              >
                <td className="px-3 py-2 text-[var(--text-2)] font-medium">{f.name}</td>
                <td className="px-3 py-2 font-mono text-[var(--foreground)]">{f.vlm}</td>
                <td className="px-3 py-2 font-mono text-[var(--text-2)]">{f.gt}</td>
                <td className="px-3 py-2 text-center">
                  {f.match ? (
                    <span className="text-green-500 font-bold">✓</span>
                  ) : (
                    <span className="text-red-500 font-bold">✗</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-[var(--text-3)] leading-relaxed">
        VLM reads all six identity fields in a single pass. Ground truth is the synthetic record used to render this document.
        {!data.passed && (
          <span className="text-amber-500 font-medium">
            {" "}Field mismatch detected — forged fields read verbatim from the tampered image.
          </span>
        )}
      </div>
    </div>
  );
}

function AuthPanel({ data }: { data: AuthResult }) {
  const elaPass = data.ela_verdict === "genuine";
  const vlmPass = data.vlm_verdict === "genuine";
  return (
    <div className="space-y-4">
      <div className="text-xs text-[var(--text-3)] font-mono mb-2">
        source: {data.source_doc_id} · threshold: {data.threshold}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-xl border border-[var(--border-c)] bg-[var(--surface-2)]">
          <div className="text-[10px] text-[var(--text-3)] uppercase tracking-wider mb-1">ELA adapter</div>
          <div className="font-bold font-mono text-sm" style={{ color: elaPass ? "#22c55e" : "#ef4444" }}>
            {data.ela_verdict.toUpperCase()}
          </div>
          <div className="text-[10px] text-[var(--text-3)] mt-0.5">{conf(data.ela_confidence)}</div>
        </div>
        <div className="p-3 rounded-xl border border-[var(--border-c)] bg-[var(--surface-2)]">
          <div className="text-[10px] text-[var(--text-3)] uppercase tracking-wider mb-1">VLM adapter</div>
          <div className="font-bold font-mono text-sm" style={{ color: vlmPass ? "#22c55e" : "#ef4444" }}>
            {data.vlm_verdict.toUpperCase()}
          </div>
          <div className="text-[10px] text-[var(--text-3)] mt-0.5">{conf(data.vlm_confidence)}</div>
        </div>
      </div>
      <div className="p-3 rounded-xl border border-[var(--border-c)] bg-[var(--surface-2)]">
        <div className="text-[10px] text-[var(--text-3)] uppercase tracking-wider mb-1">Stage verdict</div>
        <div className="font-bold font-mono" style={{ color: data.passed ? "#22c55e" : "#ef4444" }}>
          {verdict(data.passed)}
        </div>
        <div className="text-[10px] text-[var(--text-3)] mt-0.5">
          VLM is the gating adapter · ELA shown for reference
        </div>
      </div>
      <div className="text-xs text-[var(--text-3)] leading-relaxed">
        ELA (Error Level Analysis) checks JPEG compression artefact consistency — compression anomalies suggest composite regions.
        The VLM examines typography, font consistency, microprint patterns, and field layout against expected document norms.
        {!data.passed && (
          <span className="text-red-400 font-medium">
            {" "}VLM detected field-replacement: altered text shows different rendering characteristics vs surrounding fields.
          </span>
        )}
      </div>
    </div>
  );
}

function FaceMatchPanel({ data }: { data: NonNullable<FaceMatchResult> }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-[var(--text-3)] font-mono">adapter: {data.adapter} · pair: {data.source_pair_id}</div>
        <div
          className="text-xs font-bold font-mono"
          style={{ color: data.passed ? "#22c55e" : "#ef4444" }}
        >
          {data.passed ? "MATCH" : "NO MATCH"}
        </div>
      </div>
      <ScoreLine score={data.score} threshold={data.threshold} />
      <div className="p-3 rounded-xl border border-[var(--border-c)] bg-[var(--info-zone)]">
        <div className="text-[10px] text-[var(--accent-c)] uppercase tracking-wider font-semibold mb-1">Cross-domain note</div>
        <p className="text-xs text-[var(--text-2)] leading-relaxed">{data.note}</p>
      </div>
      <div className="text-xs text-[var(--text-3)] leading-relaxed">
        ArcFace cosine similarity compares a 512-d embedding of the card portrait against the selfie embedding.
        The EER threshold on cross-domain pairs (printed portrait ↔ synthetic selfie) sits lower than the selfie-to-selfie threshold
        due to print degradation, compression, and lighting shift.
      </div>
    </div>
  );
}

function DecisionPanel({
  decision,
  reason,
}: {
  decision: string;
  reason: string;
}) {
  const accept = decision === "PASS";
  const refer = decision === "REFER";
  const color = accept ? "#22c55e" : refer ? "#f59e0b" : "#ef4444";
  return (
    <div className="space-y-4">
      <div
        className="p-5 rounded-xl border-2 text-center"
        style={{ borderColor: color, background: `${color}12` }}
      >
        <div className="text-3xl font-bold font-mono mb-1" style={{ color }}>
          {decision}
        </div>
        <div className="text-xs text-[var(--text-2)] leading-relaxed max-w-xs mx-auto">{reason}</div>
      </div>
      <div className="text-xs text-[var(--text-3)] leading-relaxed">
        In a production IDV pipeline, PASS would proceed to biometric enrolment, REFER triggers a human review queue,
        and REJECT terminates the session with an adverse action notice.
        This eval runs in offline batch mode — no such routing exists here.
      </div>
    </div>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="p-3 rounded-xl border border-[var(--border-c)] bg-[var(--surface-2)]">
      <div className="text-[10px] text-[var(--text-3)] uppercase tracking-wider mb-1">{label}</div>
      <div className="font-bold font-mono text-sm" style={{ color: color ?? "var(--foreground)" }}>
        {value}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function HardCopyActionClient({ examples }: { examples: Example[] }) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [activeStage, setActiveStage] = useState<StageId>("classify");
  const [animating, setAnimating] = useState(false);

  const example = examples[selectedIdx];

  // Reset stage on example switch
  useEffect(() => {
    setActiveStage("classify");
  }, [selectedIdx]);

  function advance() {
    const idx = STAGES.indexOf(activeStage);
    if (idx < STAGES.length - 1) {
      const next = STAGES[idx + 1];
      // Skip face_match if null
      if (next === "face_match" && example.face_match === null) {
        setActiveStage("decision");
      } else {
        setActiveStage(next);
      }
    }
  }

  function runAll() {
    setAnimating(true);
    let delay = 0;
    const stages = STAGES.filter((s) => !(s === "face_match" && example.face_match === null));
    stages.forEach((s) => {
      delay += 600;
      setTimeout(() => setActiveStage(s), delay);
    });
    setTimeout(() => setAnimating(false), delay + 100);
  }

  const isLast = activeStage === "decision";
  const stageIdx = STAGES.indexOf(activeStage);
  const canAdvance = !isLast && !(
    STAGES[stageIdx + 1] === "face_match" && example.face_match === null && activeStage === "authenticate"
      ? false  // will skip to decision
      : false
  );

  return (
    <div className="px-4 py-8 lg:px-10 lg:py-10 max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <div
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-mono mb-4"
          style={{
            background: "var(--primary-wash)",
            color: "var(--accent-c)",
            border: "1px solid var(--accent-c)",
          }}
        >
          IDV · Document Pipeline · Precomputed
        </div>
        <h1
          className="text-2xl font-bold mb-1"
          style={{ fontFamily: "var(--font-display)", color: "var(--foreground)" }}
        >
          IDV in Action
        </h1>
        <p className="text-sm text-[var(--text-2)] max-w-xl">
          Walk a document through the four-stage verification pipeline. Toggle between genuine and forged to see where each breaks down.
        </p>
      </div>

      {/* Toggle */}
      <div className="flex gap-2 mb-6">
        {examples.map((ex, i) => (
          <button
            key={ex.id}
            onClick={() => setSelectedIdx(i)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-all ${
              i === selectedIdx
                ? "border-[var(--accent-c)] bg-[var(--primary-wash)] text-[var(--accent-c)]"
                : "border-[var(--border-c)] text-[var(--text-2)] hover:border-[var(--accent-c)]/40 hover:text-[var(--foreground)]"
            }`}
          >
            {ex.toggle_label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* Left: document image + honesty label */}
        <div className="space-y-4">
          <div className="rounded-xl overflow-hidden border border-[var(--border-c)] bg-[var(--surface)]">
            <div className="relative w-full" style={{ aspectRatio: "8/5" }}>
              <Image
                src={example.doc_image}
                alt={`${example.toggle_label} document`}
                fill
                className="object-contain"
                sizes="280px"
              />
            </div>
            <div className="px-3 py-2 border-t border-[var(--border-c)] bg-[var(--surface-2)]">
              <div className="text-[10px] text-[var(--text-3)] font-mono">
                {example.id} · {example.toggle_label.toLowerCase()}
              </div>
            </div>
          </div>

          {/* Face match card image (shown only at face_match stage) */}
          {activeStage === "face_match" && example.face_match !== null && (
            <div className="rounded-xl overflow-hidden border border-[var(--border-c)] bg-[var(--surface)]">
              <div className="relative w-full" style={{ aspectRatio: "8/5" }}>
                <Image
                  src={example.card_image}
                  alt="Card with face portrait"
                  fill
                  className="object-contain"
                  sizes="280px"
                />
              </div>
              <div className="px-3 py-2 border-t border-[var(--border-c)] bg-[var(--surface-2)]">
                <div className="text-[10px] text-[var(--text-3)] font-mono">card portrait · face match input</div>
              </div>
            </div>
          )}

          {/* Honesty label */}
          <div className="p-3 rounded-xl border border-[var(--border-c)] bg-[var(--surface-2)]">
            <div className="text-[10px] text-[var(--accent-c)] font-semibold uppercase tracking-wider mb-1">Synthetic data</div>
            <p className="text-[11px] text-[var(--text-3)] leading-relaxed">{example.honesty}</p>
          </div>
        </div>

        {/* Right: pipeline */}
        <div>
          {/* Pipeline rail */}
          <PipelineRail active={activeStage} example={example} onSelect={setActiveStage} />

          {/* Stage panel */}
          <div className="rounded-xl border border-[var(--border-c)] bg-[var(--surface)] p-5 min-h-[280px]">
            <div className="flex items-center justify-between mb-4">
              <h2
                className="text-base font-bold"
                style={{ fontFamily: "var(--font-display)", color: "var(--accent-c)" }}
              >
                {STAGE_LABELS[activeStage]}
              </h2>
              <div className="text-[10px] text-[var(--text-3)] font-mono">
                stage {stageIdx + 1} / {STAGES.length}
              </div>
            </div>

            {activeStage === "classify" && <ClassifyPanel data={example.classify} />}
            {activeStage === "extract" && <ExtractPanel data={example.extract} />}
            {activeStage === "authenticate" && <AuthPanel data={example.authenticate} />}
            {activeStage === "face_match" && example.face_match && (
              <FaceMatchPanel data={example.face_match} />
            )}
            {activeStage === "face_match" && !example.face_match && (
              <div className="text-sm text-[var(--text-3)]">Pipeline stopped at Authenticate. Face match not reached.</div>
            )}
            {activeStage === "decision" && (
              <DecisionPanel decision={example.decision} reason={example.decision_reason} />
            )}
          </div>

          {/* Controls */}
          <div className="flex gap-3 mt-4">
            {!isLast && (
              <button
                onClick={advance}
                className="px-4 py-2 rounded-lg text-sm font-semibold border border-[var(--accent-c)] bg-[var(--primary-wash)] text-[var(--accent-c)] hover:bg-[var(--accent-c)] hover:text-white transition-all"
              >
                Next stage →
              </button>
            )}
            <button
              onClick={runAll}
              disabled={animating}
              className="px-4 py-2 rounded-lg text-sm font-semibold border border-[var(--border-c)] text-[var(--text-2)] hover:border-[var(--accent-c)]/40 hover:text-[var(--foreground)] transition-all disabled:opacity-40"
            >
              Run all stages
            </button>
            {isLast && (
              <button
                onClick={() => setActiveStage("classify")}
                className="px-4 py-2 rounded-lg text-sm font-semibold border border-[var(--border-c)] text-[var(--text-2)] hover:border-[var(--accent-c)]/40 transition-all"
              >
                ↺ Reset
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
