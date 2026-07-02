"use client";
import { useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar, Legend, ReferenceLine,
} from "recharts";

// ─── Types ───────────────────────────────────────────────────────────────────
type FieldMetrics = { cer: number; accuracy: number };
type FieldF1 = { precision: number; recall: number; f1: number };
type CostBlock = { calls: number; tokens_in: number; tokens_out: number; usd_total: number; usd_per_doc: number };
type LatBlock = { p50: number; p95: number };
type ExtrAdapter = { adapter_id: string; cer: number; field_accuracy: number; field_f1: FieldF1; per_field?: Record<string, FieldMetrics>; cost: CostBlock; latency_ms: LatBlock };
type AuthRocPt = { threshold: number; apcer: number; bpcer: number };
type AuthAdapter = { adapter_id: string; operating_threshold: number; apcer: number; bpcer: number; acer: number; auc: number; by_forgery_type?: Array<{ forgery_type: string; apcer: number; n: number }>; roc: AuthRocPt[]; cost: CostBlock; latency_ms: LatBlock };
type FaceRocPt = { threshold: number; far: number; frr: number; tar: number };
type FaceMatch = { dataset: string; n_genuine_pairs: number; n_impostor_pairs: number; adapter_id: string; selfie_threshold: number; doc_threshold: number; selfie_far: number; selfie_frr: number; doc_far: number; doc_frr: number; threshold_delta_note: string; roc: FaceRocPt[] };
type Extraction = { dataset: string; n_documents: number; fields_evaluated: string[]; adapters: ExtrAdapter[]; comparison: { vlm_vs_ocr_cer_delta: number; vlm_wins: boolean; note: string } };
type Authenticity = { dataset: string; n_genuine: number; n_forged: number; adapters: AuthAdapter[] };
type Run = { id: string; timestamp: string; vlm_mode: string; total_cost_usd: number };
type IdvRun = { schema_version: string; run: Run; extraction: Extraction; authenticity: Authenticity; face_match: FaceMatch };

type V15AdapterMetrics = { apcer: number | null; bpcer: number | null; acer: number | null; auc: number | null; n: number | null };
type V15Comparison = Record<string, { v1_synthetic: V15AdapterMetrics; v1_5_hf: V15AdapterMetrics; acer_delta?: number; auc_delta?: number }>;
type IdvRunV15 = {
  schema_version: string;
  run: { id: string; timestamp: string; vlm_mode: string; total_cost_usd: number; note: string };
  source: { dataset: string; license: string; attribution: string; is_synthetic: boolean; framing: string };
  authenticity: { dataset: string; n_genuine: number; n_forged: number; n_ela: number; n_vlm: number; adapters: AuthAdapter[] };
  generalization_comparison: V15Comparison;
};

// ─── Utilities ───────────────────────────────────────────────────────────────
const pct = (n: number) => (n * 100).toFixed(1) + "%";
const fmt = (n: number, d = 3) => n.toFixed(d);
const usd = (n: number) => "$" + n.toFixed(4);
const downsample = <T,>(arr: T[], n: number): T[] => {
  const step = Math.max(1, Math.floor(arr.length / n));
  return arr.filter((_, i) => i % step === 0);
};

// ─── Shared primitives ────────────────────────────────────────────────────────
function Card({ children, full, className = "" }: { children: React.ReactNode; full?: boolean; className?: string }) {
  return (
    <div className={`p-5 rounded-xl border border-[var(--border-c)] bg-[var(--surface)] ${full ? "col-span-full" : ""} ${className}`}>
      {children}
    </div>
  );
}
function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="p-4 rounded-xl border border-[var(--border-c)] bg-[var(--surface-2)]">
      <div className="text-[10px] text-[var(--text-3)] uppercase tracking-wider mb-1">{label}</div>
      <div className="text-xl font-bold font-mono" style={{ color: color ?? "var(--foreground)" }}>{value}</div>
      {sub && <div className="text-[10px] text-[var(--text-3)] mt-0.5">{sub}</div>}
    </div>
  );
}
function Caveat({ text }: { text: string }) {
  return (
    <div className="p-3 rounded-lg border border-[var(--uncertain)] bg-[var(--uncertain-zone)] text-[var(--uncertain)] text-xs mb-4">
      ⚠ {text}
    </div>
  );
}
function InfoBanner({ text }: { text: string }) {
  return (
    <div className="p-3 rounded-lg border border-[var(--accent-c)] bg-[var(--info-zone)] text-[var(--accent-c)] text-xs mb-4">
      ℹ {text}
    </div>
  );
}
function GovNote() {
  return (
    <div className="p-4 rounded-xl border border-[var(--accent-c)] bg-[var(--info-zone)] text-sm mb-6">
      <div className="font-semibold mb-1" style={{ color: "var(--accent-c)", fontFamily: "var(--font-display)" }}>
        Data Minimisation & Retention — GDPR framing
      </div>
      <p className="text-[var(--text-2)] text-xs leading-relaxed">
        Document field extraction manufactures structured PII (name, DOB, document number) that did not exist as structured data before.
        Under GDPR/UK GDPR: you need a lawful basis (e.g. contractual necessity for KYC) to extract; data minimisation requires
        keeping only what&apos;s needed for the verified purpose; and retention limits mean full document images should not be stored
        indefinitely — extract the fields needed, delete the image. This prototype uses specimen/synthetic data only and retains no
        real PII. In a production flow, the consent and retention schedule would be defined before extraction begins.
      </p>
    </div>
  );
}

// ─── Extraction tab ───────────────────────────────────────────────────────────
function ExtractionTab({ data }: { data: Extraction }) {
  const vlm = data.adapters.find(a => a.adapter_id === "vlm_extract");
  const ocr = data.adapters.find(a => a.adapter_id === "ocr_baseline");

  const fieldRows = data.fields_evaluated.map(f => ({
    field: f,
    vlm_cer: vlm?.per_field?.[f]?.cer ?? 0,
    ocr_cer: ocr?.per_field?.[f]?.cer ?? 0,
    vlm_acc: vlm?.per_field?.[f]?.accuracy ?? 0,
    ocr_acc: ocr?.per_field?.[f]?.accuracy ?? 0,
  }));

  return (
    <div className="space-y-5">
      <Caveat text={`Dataset: ${data.dataset} · ${data.n_documents} documents`} />
      <InfoBanner text={data.comparison.note} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="VLM CER" value={fmt(vlm?.cer ?? 0)} color={data.comparison.vlm_wins ? "var(--accept)" : "var(--uncertain)"} sub="lower is better" />
        <Kpi label="OCR CER" value={fmt(ocr?.cer ?? 0)} sub="Tesseract baseline" />
        <Kpi label="VLM Field Acc" value={pct(vlm?.field_accuracy ?? 0)} color="var(--accent-c)" />
        <Kpi label="VLM F1" value={fmt(vlm?.field_f1.f1 ?? 0)} color="var(--accent-c)" />
      </div>

      {fieldRows.length > 0 && (
        <Card full>
          <div className="text-sm font-semibold mb-3" style={{ fontFamily: "var(--font-display)" }}>Per-Field CER</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={fieldRows} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-c)" />
              <XAxis dataKey="field" tick={{ fontSize: 10, fill: "var(--text-2)" }} />
              <YAxis tick={{ fontSize: 10, fill: "var(--text-2)" }} domain={[0, 1]} />
              <Tooltip contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border-c)", borderRadius: 8, fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="vlm_cer" name="VLM CER" fill="var(--accent-c)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="ocr_cer" name="OCR CER" fill="var(--text-3)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        {[vlm, ocr].filter(Boolean).map(a => a && (
          <Card key={a.adapter_id}>
            <div className="text-xs font-semibold mb-3 uppercase tracking-wide" style={{ color: "var(--accent-c)" }}>{a.adapter_id}</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="text-[var(--text-2)]">CER</div><div className="font-mono">{fmt(a.cer)}</div>
              <div className="text-[var(--text-2)]">Field Accuracy</div><div className="font-mono">{pct(a.field_accuracy)}</div>
              <div className="text-[var(--text-2)]">Precision</div><div className="font-mono">{fmt(a.field_f1.precision)}</div>
              <div className="text-[var(--text-2)]">Recall</div><div className="font-mono">{fmt(a.field_f1.recall)}</div>
              <div className="text-[var(--text-2)]">F1</div><div className="font-mono">{fmt(a.field_f1.f1)}</div>
              <div className="text-[var(--text-2)]">Cost / doc</div><div className="font-mono">{usd(a.cost.usd_per_doc)}</div>
              <div className="text-[var(--text-2)]">Latency p50</div><div className="font-mono">{a.latency_ms.p50}ms</div>
              <div className="text-[var(--text-2)]">Latency p95</div><div className="font-mono">{a.latency_ms.p95}ms</div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Authenticity tab ─────────────────────────────────────────────────────────
function AuthenticityTab({ data }: { data: Authenticity }) {
  const vlm = data.adapters.find(a => a.adapter_id === "vlm_doc_auth");
  const ela = data.adapters.find(a => a.adapter_id === "auth_baseline");

  const rocData = vlm?.roc ? downsample(vlm.roc, 80) : [];

  return (
    <div className="space-y-5">
      <Caveat text={`Dataset: ${data.dataset} · ${data.n_genuine} genuine + ${data.n_forged} forged`} />
      <InfoBanner text="APCER = forged documents accepted as genuine (security failure). BPCER = genuine documents rejected as forged (friction). ACER = mean. Lower is better." />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="VLM APCER" value={pct(vlm?.apcer ?? 0)} color={((vlm?.apcer ?? 1) < 0.1) ? "var(--accept)" : "var(--reject)"} />
        <Kpi label="VLM BPCER" value={pct(vlm?.bpcer ?? 0)} />
        <Kpi label="VLM ACER" value={pct(vlm?.acer ?? 0)} color="var(--accent-c)" />
        <Kpi label="VLM AUC" value={fmt(vlm?.auc ?? 0, 3)} color="var(--accept)" />
      </div>

      {rocData.length > 1 && (
        <Card full>
          <div className="text-sm font-semibold mb-3" style={{ fontFamily: "var(--font-display)" }}>ROC — APCER vs BPCER Trade-off</div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={rocData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-c)" />
              <XAxis dataKey="apcer" type="number" domain={[0, 1]} tickFormatter={v => pct(v)} tick={{ fontSize: 10, fill: "var(--text-2)" }} label={{ value: "APCER", position: "insideBottomRight", offset: -5, fontSize: 10, fill: "var(--text-2)" }} />
              <YAxis dataKey="bpcer" domain={[0, 1]} tickFormatter={v => pct(v)} tick={{ fontSize: 10, fill: "var(--text-2)" }} label={{ value: "BPCER", angle: -90, position: "insideLeft", fontSize: 10, fill: "var(--text-2)" }} />
              <Tooltip contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border-c)", borderRadius: 8, fontSize: 11 }} formatter={(v) => typeof v === "number" ? pct(v) : v} />
              <Line dataKey="bpcer" stroke="var(--accent-c)" dot={false} strokeWidth={2} />
              <ReferenceLine x={vlm?.operating_threshold} stroke="var(--uncertain)" strokeDasharray="4 2" label={{ value: "op", fontSize: 9, fill: "var(--uncertain)" }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        {[vlm, ela].filter(Boolean).map(a => a && (
          <Card key={a.adapter_id}>
            <div className="text-xs font-semibold mb-3 uppercase tracking-wide" style={{ color: "var(--accent-c)" }}>{a.adapter_id}</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="text-[var(--text-2)]">APCER</div><div className="font-mono">{pct(a.apcer)}</div>
              <div className="text-[var(--text-2)]">BPCER</div><div className="font-mono">{pct(a.bpcer)}</div>
              <div className="text-[var(--text-2)]">ACER</div><div className="font-mono">{pct(a.acer)}</div>
              <div className="text-[var(--text-2)]">AUC</div><div className="font-mono">{fmt(a.auc, 3)}</div>
              <div className="text-[var(--text-2)]">Op. Threshold</div><div className="font-mono">{fmt(a.operating_threshold, 2)}</div>
              <div className="text-[var(--text-2)]">Cost / doc</div><div className="font-mono">{usd(a.cost.usd_per_doc)}</div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Face-on-document tab ─────────────────────────────────────────────────────
function FaceMatchTab({ data }: { data: FaceMatch }) {
  const rocData = downsample(data.roc, 100);
  return (
    <div className="space-y-5">
      <Caveat text={`${data.n_genuine_pairs} genuine pairs · ${data.n_impostor_pairs} impostor pairs · ArcFace`} />
      <InfoBanner text={data.threshold_delta_note} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Selfie Threshold" value={fmt(data.selfie_threshold, 2)} sub="selfie-to-selfie" />
        <Kpi label="Doc Threshold" value={fmt(data.doc_threshold, 4)} color="var(--accent-c)" sub="document-tuned (looser)" />
        <Kpi label="Doc FAR @ doc-thresh" value={pct(data.doc_far)} />
        <Kpi label="Doc FRR @ doc-thresh" value={pct(data.doc_frr)} />
      </div>

      {rocData.length > 1 && (
        <Card full>
          <div className="text-sm font-semibold mb-3" style={{ fontFamily: "var(--font-display)" }}>ROC — Document pairs</div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={rocData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-c)" />
              <XAxis dataKey="far" type="number" domain={[0, 1]} tickFormatter={v => pct(v)} tick={{ fontSize: 10, fill: "var(--text-2)" }} label={{ value: "FAR", position: "insideBottomRight", offset: -5, fontSize: 10, fill: "var(--text-2)" }} />
              <YAxis dataKey="tar" domain={[0, 1]} tickFormatter={v => pct(v)} tick={{ fontSize: 10, fill: "var(--text-2)" }} label={{ value: "TAR", angle: -90, position: "insideLeft", fontSize: 10, fill: "var(--text-2)" }} />
              <Tooltip contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border-c)", borderRadius: 8, fontSize: 11 }} formatter={(v) => typeof v === "number" ? pct(v) : v} />
              <Line dataKey="tar" stroke="var(--accent-c)" dot={false} strokeWidth={2} name="TAR" />
              <ReferenceLine x={data.doc_far} stroke="var(--uncertain)" strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      <div className="p-4 rounded-xl border border-[var(--border-c)] bg-[var(--surface)] text-sm text-[var(--text-2)] leading-relaxed">
        <span className="font-semibold text-[var(--foreground)]">Why the threshold is looser:</span> A document photo is printed at ~300 dpi, photographed under variable lighting, and may be blurred or skewed.
        ArcFace embeds this degraded image into a region of the embedding space that&apos;s further from a live selfie of the same person,
        so the similarity score for a genuine pair is lower than for two selfies of the same person. The operating threshold must shift
        to accommodate this — but that shift widens the FAR/FRR trade-off space compared to selfie-to-selfie.
      </div>
    </div>
  );
}

// ─── Generalization tab ───────────────────────────────────────────────────────
function GeneralizationTab({ data }: { data: IdvRunV15 }) {
  const cmp = data.generalization_comparison;
  const vlm = cmp["vlm_doc_auth"];
  const ela = cmp["auth_baseline"];

  const barData = [
    { adapter: "VLM", v1_auc: vlm?.v1_synthetic?.auc ?? 0, v15_auc: vlm?.v1_5_hf?.auc ?? 0 },
    { adapter: "ELA", v1_auc: ela?.v1_synthetic?.auc ?? 0, v15_auc: ela?.v1_5_hf?.auc ?? 0 },
  ];

  const sign = (n: number | undefined) => n === undefined ? "—" : n > 0.01 ? `▲ +${(n*100).toFixed(1)}pp` : n < -0.01 ? `▼ ${(n*100).toFixed(1)}pp` : "≈ stable";

  return (
    <div className="space-y-5">
      <Caveat text={`Dataset: ${data.source.dataset} · ${data.source.license} · ${data.authenticity.n_genuine} genuine + ${data.authenticity.n_forged} forged`} />
      <InfoBanner text={data.source.framing} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="VLM AUC — v1" value={fmt(vlm?.v1_synthetic?.auc ?? 0)} sub="synthetic corpus" color="var(--accept)" />
        <Kpi label="VLM AUC — v1.5" value={fmt(vlm?.v1_5_hf?.auc ?? 0)} sub="HF SID_Set" color={((vlm?.v1_5_hf?.auc ?? 0) >= 0.85) ? "var(--accent-c)" : "var(--uncertain)"} />
        <Kpi label="VLM ΔACER" value={sign(vlm?.acer_delta)} sub="+ = worse on HF" color={(vlm?.acer_delta ?? 0) > 0.05 ? "var(--uncertain)" : "var(--accept)"} />
        <Kpi label="Run cost" value={`$${data.run.total_cost_usd.toFixed(4)}`} sub={`${data.authenticity.n_vlm} VLM calls`} />
      </div>

      <Card full>
        <div className="text-sm font-semibold mb-3" style={{ fontFamily: "var(--font-display)" }}>AUC: v1 synthetic vs v1.5 HF</div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={barData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-c)" />
            <XAxis dataKey="adapter" tick={{ fontSize: 11, fill: "var(--text-2)" }} />
            <YAxis domain={[0, 1]} tick={{ fontSize: 10, fill: "var(--text-2)" }} />
            <Tooltip contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border-c)", borderRadius: 8, fontSize: 11 }} formatter={(v) => typeof v === "number" ? fmt(v) : v} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="v1_auc" name="v1 (synthetic)" fill="var(--text-3)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="v15_auc" name="v1.5 (HF)" fill="var(--accent-c)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid sm:grid-cols-2 gap-4">
        {[["vlm_doc_auth", vlm], ["auth_baseline", ela]].map(([aid, c]) => {
          const comp = c as typeof vlm;
          if (!comp) return null;
          return (
            <Card key={aid as string}>
              <div className="text-xs font-semibold mb-3 uppercase tracking-wide" style={{ color: "var(--accent-c)" }}>{aid as string}</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {(["apcer", "bpcer", "acer", "auc"] as const).map(metric => (
                  <>
                    <div key={`v1-${metric}`} className="text-[var(--text-2)]">v1 {metric.toUpperCase()}</div>
                    <div key={`v1-val-${metric}`} className="font-mono">{comp.v1_synthetic?.[metric] != null ? (metric === "auc" ? fmt(comp.v1_synthetic[metric]!) : pct(comp.v1_synthetic[metric]!)) : "—"}</div>
                    <div key={`v15-${metric}`} className="text-[var(--text-2)]">v1.5 {metric.toUpperCase()}</div>
                    <div key={`v15-val-${metric}`} className="font-mono">{comp.v1_5_hf?.[metric] != null ? (metric === "auc" ? fmt(comp.v1_5_hf[metric]!) : pct(comp.v1_5_hf[metric]!)) : "—"}</div>
                  </>
                ))}
                <div className="text-[var(--text-2)]">ΔACER</div>
                <div className="font-mono" style={{ color: (comp.acer_delta ?? 0) > 0.05 ? "var(--uncertain)" : "var(--accept)" }}>
                  {comp.acer_delta != null ? sign(comp.acer_delta) : "—"}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="p-4 rounded-xl border border-[var(--border-c)] bg-[var(--surface)] text-sm text-[var(--text-2)] leading-relaxed">
        <span className="font-semibold text-[var(--foreground)]">What the gap means:</span>{" "}
        VLM ACER rising from 0% to 13.3% on a different synthetic generator shows partial over-fit to v1 rendering
        artefacts — the model learned some cues specific to this project&apos;s document generator, not purely structural
        document reasoning. AUC of 0.90 is still useful; it is not random. ELA is consistently random (AUC 0.50) across
        both generators — confirming JPEG re-compression forensics carry no signal here regardless of source.
        Next step: validate against a real-document dataset to separate synthetic-generator bias from genuine generalization.
      </div>

      <div className="text-[10px] text-[var(--text-3)] mt-2">
        Source: {data.source.dataset} · {data.source.license} · {data.source.attribution}
      </div>
    </div>
  );
}

// ─── Run summary (above tabs) ─────────────────────────────────────────────────
function RunSummary({ run }: { run: IdvRun }) {
  const extVlm = run.extraction.adapters.find(a => a.adapter_id === "vlm_extract");
  const extOcr = run.extraction.adapters.find(a => a.adapter_id === "ocr_baseline");
  const authVlm = run.authenticity.adapters.find(a => a.adapter_id === "vlm_doc_auth");
  const authEla = run.authenticity.adapters.find(a => a.adapter_id === "auth_baseline");
  const fm = run.face_match;

  return (
    <div className="mb-10 space-y-6">
      {/* Top-line KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="VLM CER" value={fmt(extVlm?.cer ?? 0, 4)} sub="vs OCR 0.709" color="var(--accept)" />
        <Kpi label="VLM Field Acc" value={pct(extVlm?.field_accuracy ?? 0)} color="var(--accent-c)" />
        <Kpi label="VLM ACER" value={pct(authVlm?.acer ?? 0)} sub="auth accuracy" color="var(--accept)" />
        <Kpi label="Doc Threshold" value={fmt(fm.doc_threshold, 4)} sub={`selfie: ${fmt(fm.selfie_threshold, 2)}`} color="var(--accent-c)" />
      </div>

      {/* Per-task summary cards */}
      <div className="grid sm:grid-cols-3 gap-4">
        {/* Extraction */}
        <div className="p-5 rounded-xl border border-[var(--border-c)] bg-[var(--surface)]">
          <div className="text-[10px] uppercase tracking-wider text-[var(--accent-c)] font-semibold mb-3">Reading</div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-[var(--text-2)]">VLM CER</span>
              <span className="font-mono text-[var(--accept)]">{fmt(extVlm?.cer ?? 0, 4)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-2)]">OCR CER</span>
              <span className="font-mono text-[var(--reject)]">{fmt(extOcr?.cer ?? 0, 3)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-2)]">VLM Field F1</span>
              <span className="font-mono">{fmt(extVlm?.field_f1.f1 ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-2)]">Cost / doc</span>
              <span className="font-mono">${extVlm?.cost.usd_per_doc.toFixed(4) ?? "—"}</span>
            </div>
          </div>
          <p className="text-[10px] text-[var(--text-3)] mt-3 leading-relaxed">
            VLM beats OCR decisively. OCR fails on messy synthetic renders; VLM reads context.
          </p>
        </div>

        {/* Authenticity */}
        <div className="p-5 rounded-xl border border-[var(--border-c)] bg-[var(--surface)]">
          <div className="text-[10px] uppercase tracking-wider text-[var(--accent-c)] font-semibold mb-3">Authenticity</div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-[var(--text-2)]">VLM APCER</span>
              <span className="font-mono text-[var(--accept)]">{pct(authVlm?.apcer ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-2)]">VLM AUC</span>
              <span className="font-mono text-[var(--accept)]">{fmt(authVlm?.auc ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-2)]">ELA APCER</span>
              <span className="font-mono text-[var(--reject)]">{pct(authEla?.apcer ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-2)]">ELA AUC</span>
              <span className="font-mono text-[var(--uncertain)]">{fmt(authEla?.auc ?? 0)}</span>
            </div>
          </div>
          <p className="text-[10px] text-[var(--text-3)] mt-3 leading-relaxed">
            VLM catches all fakes (AUC 1.0). ELA baseline accepts every forged doc (APCER 100%).
          </p>
        </div>

        {/* Face match */}
        <div className="p-5 rounded-xl border border-[var(--border-c)] bg-[var(--surface)]">
          <div className="text-[10px] uppercase tracking-wider text-[var(--accent-c)] font-semibold mb-3">Face-on-Document</div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-[var(--text-2)]">Doc threshold</span>
              <span className="font-mono">{fmt(fm.doc_threshold, 4)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-2)]">Selfie threshold</span>
              <span className="font-mono">{fmt(fm.selfie_threshold, 2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-2)]">Doc FAR</span>
              <span className="font-mono">{pct(fm.doc_far)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-2)]">Doc FRR</span>
              <span className="font-mono">{pct(fm.doc_frr)}</span>
            </div>
          </div>
          <p className="text-[10px] text-[var(--text-3)] mt-3 leading-relaxed">
            Printed portrait degrades ArcFace signal. Doc threshold shifts lower to compensate.
          </p>
        </div>
      </div>

      {/* What this teaches */}
      <div className="grid sm:grid-cols-3 gap-4">
        {[
          {
            title: "VLM wins on reading, not matching",
            body: "The specialist model (ArcFace) dominates face matching. On document reading the roles reverse: layout complexity and multilingual text beat OCR's regex assumptions.",
          },
          {
            title: "Cross-domain threshold shift",
            body: `Document photo → selfie cosine similarity is lower than selfie → selfie. Operating threshold shifts from ${fmt(fm.selfie_threshold, 2)} to ${fmt(fm.doc_threshold, 4)}. Every looser threshold widens the FAR/FRR trade-off.`,
          },
          {
            title: "ELA is a random baseline",
            body: "Error Level Analysis flags JPEG re-compression artefacts. It accepted every forged document in this corpus (APCER 100%), making it indistinguishable from a coin flip. Reasoning beats forensics here.",
          },
        ].map(({ title, body }) => (
          <div key={title} className="p-5 rounded-xl border border-[var(--border-c)] bg-[var(--surface-2)]">
            <div className="text-sm font-semibold mb-2" style={{ fontFamily: "var(--font-display)", color: "var(--accent-c)" }}>{title}</div>
            <p className="text-xs text-[var(--text-2)] leading-relaxed">{body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────
const TABS_BASE    = ["Extraction", "Authenticity", "Face Match"];
const TABS_WITH_GEN = [...TABS_BASE, "Generalization ↗"];

export function HardCopyResultsClient({ idvRun, idvRunV15 }: { idvRun: object | null; idvRunV15?: object | null }) {
  const [tab, setTab] = useState(0);
  const run   = idvRun   as IdvRun     | null;
  const v15   = idvRunV15 as IdvRunV15 | null;
  const TABS  = v15 ? TABS_WITH_GEN : TABS_BASE;

  if (!run) {
    return (
      <div className="px-6 py-10 lg:px-12 lg:py-12 max-w-5xl">
        <h1 className="text-3xl font-bold mb-4" style={{ fontFamily: "var(--font-display)" }}>Results</h1>
        <div className="p-6 rounded-xl border border-[var(--border-c)] bg-[var(--surface-2)] text-[var(--text-2)]">
          <p className="mb-2">No results yet. Run the IDV eval to generate <code className="font-mono text-[var(--accent-c)]">idv_run.json</code>:</p>
          <pre className="text-xs font-mono bg-[var(--surface)] p-3 rounded-lg border border-[var(--border-c)] overflow-x-auto">
            {`# 1. Build corpus (downloads/generates data)
python -m idv.build_idv_corpus

# 2. Run eval
python -m idv.run_idv_eval --vlm-mode cli

# 3. Rebuild portal
cd portal-next && npm run build`}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-10 lg:px-12 lg:py-12 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-1" style={{ fontFamily: "var(--font-display)" }}>Results</h1>
        <p className="text-[var(--text-2)] text-sm">
          Run {run.run.id} · {new Date(run.run.timestamp).toLocaleString()} · {run.run.vlm_mode} · ${run.run.total_cost_usd.toFixed(4)} total
        </p>
      </div>

      <GovNote />

      <RunSummary run={run} />

      {/* Tab bar */}
      <div className="text-base font-semibold mb-4" style={{ fontFamily: "var(--font-display)" }}>Drill-down</div>
      <div className="flex gap-1 mb-6 p-1 rounded-lg bg-[var(--surface-2)] w-fit">
        {TABS.map((t, i) => (
          <button
            key={t}
            onClick={() => setTab(i)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === i
                ? "bg-[var(--surface)] text-[var(--foreground)] shadow-sm"
                : "text-[var(--text-2)] hover:text-[var(--foreground)]"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 0 && <ExtractionTab data={run.extraction} />}
      {tab === 1 && <AuthenticityTab data={run.authenticity} />}
      {tab === 2 && <FaceMatchTab data={run.face_match} />}
      {tab === 3 && v15 && <GeneralizationTab data={v15} />}
    </div>
  );
}
