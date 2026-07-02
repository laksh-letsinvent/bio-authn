"use client";
import { useState, useRef } from "react";

type ExtractionResult = { fields: Record<string, string>; adapter: string; latency_ms: number; cost_usd: number };
type AuthResult = { genuine: boolean; confidence: number; reasoning: string; adapter: string; latency_ms: number };
type FaceMatchResult = { score: number; decision: boolean; threshold: number; adapter: string; latency_ms: number } | null;
type TryoutState = "idle" | "uploading" | "done" | "error";

const FIELDS = ["surname", "given_names", "dob", "doc_number", "expiry", "nationality"];
const FIELD_LABELS: Record<string, string> = {
  surname: "Surname", given_names: "Given Names", dob: "Date of Birth",
  doc_number: "Document Number", expiry: "Expiry", nationality: "Nationality",
};

function UploadZone({
  label, accept, file, onFile, disabled,
}: {
  label: string; accept: string; file: File | null;
  onFile: (f: File) => void; disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div
      className="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors"
      style={{ borderColor: file ? "var(--accent-c)" : "var(--border-c)", background: file ? "var(--primary-wash)" : "var(--surface-2)" }}
      onClick={() => !disabled && ref.current?.click()}
    >
      <input ref={ref} type="file" accept={accept} className="hidden" disabled={disabled}
        onChange={e => { if (e.target.files?.[0]) onFile(e.target.files[0]); }} />
      <div className="text-2xl mb-2">{file ? "✓" : "↑"}</div>
      <div className="text-sm font-medium" style={{ color: file ? "var(--accent-c)" : "var(--text-2)" }}>
        {file ? file.name : label}
      </div>
      {!file && <div className="text-xs text-[var(--text-3)] mt-1">Click or drag to upload</div>}
    </div>
  );
}

function ResultBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold"
      style={{ background: ok ? "var(--accept-zone)" : "var(--reject-zone)", color: ok ? "var(--accept)" : "var(--reject)", border: `1px solid ${ok ? "var(--accept)" : "var(--reject)"}` }}>
      {ok ? "✓" : "✗"} {label}
    </span>
  );
}

export function HardCopyTryoutClient() {
  const [docFile, setDocFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [state, setState] = useState<TryoutState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);
  const [auth, setAuth] = useState<AuthResult | null>(null);
  const [faceMatch, setFaceMatch] = useState<FaceMatchResult>(null);

  const canRun = docFile !== null && state !== "uploading";

  async function runAnalysis() {
    if (!docFile) return;
    setState("uploading");
    setError(null);
    setExtraction(null);
    setAuth(null);
    setFaceMatch(null);

    try {
      const fd = new FormData();
      fd.append("document", docFile);
      if (selfieFile) fd.append("selfie", selfieFile);

      const resp = await fetch("/api/idv/analyze", { method: "POST", body: fd });
      if (!resp.ok) {
        const msg = await resp.text().catch(() => "Unknown error");
        throw new Error(`Server error ${resp.status}: ${msg}`);
      }
      const result = await resp.json();
      setExtraction(result.extraction ?? null);
      setAuth(result.authenticity ?? null);
      setFaceMatch(result.face_match ?? null);
      setState("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }

  return (
    <div className="px-6 py-10 lg:px-12 lg:py-12 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-1" style={{ fontFamily: "var(--font-display)" }}>Try It</h1>
        <p className="text-[var(--text-2)] text-sm max-w-2xl">
          Upload a document image to run extraction, authenticity check, and (optionally)
          face-on-document match against a selfie. Uses the same VLM and ArcFace backend as the eval.
        </p>
        <div className="mt-3 p-3 rounded-lg border border-[var(--uncertain)] bg-[var(--uncertain-zone)] text-[var(--uncertain)] text-xs">
          ⚠ Demo mode — the backend may be offline. No real PII is stored. Use specimen documents only.
          Uploaded images are processed in-memory and discarded immediately.
        </div>
      </div>

      {/* Upload zone */}
      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-2)] mb-2">Document Image *</div>
          <UploadZone label="Upload ID document" accept="image/*" file={docFile} onFile={setDocFile} disabled={state === "uploading"} />
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-2)] mb-2">Selfie (optional — for face match)</div>
          <UploadZone label="Upload selfie" accept="image/*" file={selfieFile} onFile={setSelfieFile} disabled={state === "uploading"} />
        </div>
      </div>

      <button
        onClick={runAnalysis}
        disabled={!canRun}
        className="px-6 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-40"
        style={{ background: "var(--accent-c)", color: "var(--background)" }}
      >
        {state === "uploading" ? "Analysing…" : "Run Analysis"}
      </button>

      {state === "error" && (
        <div className="mt-4 p-4 rounded-xl border border-[var(--reject)] bg-[var(--reject-zone)] text-[var(--reject)] text-sm">
          {error ?? "An error occurred."}
          <p className="mt-1 text-xs opacity-75">The backend may be offline in this environment. Run the API locally to use the Try-out.</p>
        </div>
      )}

      {/* Results */}
      {state === "done" && (
        <div className="mt-8 space-y-6">
          {/* Extraction */}
          {extraction && (
            <div>
              <div className="text-base font-semibold mb-3" style={{ fontFamily: "var(--font-display)" }}>Extraction</div>
              <div className="p-4 rounded-xl border border-[var(--border-c)] bg-[var(--surface)]">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
                  {FIELDS.map(f => (
                    <div key={f} className="p-3 rounded-lg bg-[var(--surface-2)]">
                      <div className="text-[10px] uppercase tracking-wider text-[var(--text-3)] mb-0.5">{FIELD_LABELS[f]}</div>
                      <div className="text-sm font-mono text-[var(--foreground)]">
                        {extraction.fields[f] || <span className="text-[var(--text-3)] italic">not found</span>}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-[var(--text-3)]">{extraction.adapter} · {extraction.latency_ms}ms · ${extraction.cost_usd.toFixed(5)}</div>
              </div>
            </div>
          )}

          {/* Authenticity */}
          {auth && (
            <div>
              <div className="text-base font-semibold mb-3" style={{ fontFamily: "var(--font-display)" }}>Authenticity</div>
              <div className="p-4 rounded-xl border border-[var(--border-c)] bg-[var(--surface)]">
                <div className="flex items-center gap-3 mb-2">
                  <ResultBadge ok={auth.genuine} label={auth.genuine ? "Genuine" : "Tampered"} />
                  <span className="text-sm font-mono text-[var(--text-2)]">confidence {(auth.confidence * 100).toFixed(0)}%</span>
                </div>
                <p className="text-sm text-[var(--text-2)] leading-relaxed">{auth.reasoning}</p>
                <div className="text-[10px] text-[var(--text-3)] mt-2">{auth.adapter} · {auth.latency_ms}ms</div>
              </div>
            </div>
          )}

          {/* Face match */}
          {faceMatch && (
            <div>
              <div className="text-base font-semibold mb-3" style={{ fontFamily: "var(--font-display)" }}>Face-on-Document Match</div>
              <div className="p-4 rounded-xl border border-[var(--border-c)] bg-[var(--surface)]">
                <div className="flex items-center gap-3 mb-2">
                  <ResultBadge ok={faceMatch.decision} label={faceMatch.decision ? "Match" : "No Match"} />
                  <span className="text-sm font-mono text-[var(--text-2)]">score {faceMatch.score.toFixed(4)} (threshold {faceMatch.threshold.toFixed(4)})</span>
                </div>
                <div className="text-[10px] text-[var(--text-3)]">{faceMatch.adapter} · {faceMatch.latency_ms}ms</div>
              </div>
            </div>
          )}

          {selfieFile && !faceMatch && (
            <div className="p-3 rounded-lg border border-[var(--uncertain)] bg-[var(--uncertain-zone)] text-[var(--uncertain)] text-xs">
              Selfie was provided but face-match was not returned — the backend may have skipped it if no face was detected in the document.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
