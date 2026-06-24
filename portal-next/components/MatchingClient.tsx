"use client";
import { useEffect, useState, useMemo } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  BarChart, Bar, ReferenceLine, CartesianGrid,
} from "recharts";

type PairScore = { pair_id: string; score: number; label: string };
type EmbedPoint = { x: number; y: number; identity: string; gender: string; age: string; skin: string };
type EmbedMap = { explained_variance: number[]; points: EmbedPoint[] };
type MatchExample = {
  pair_id: string; label: string; score: number;
  ref_image: string; probe_image: string;
  ref_embedding_512: number[];
  probe_embedding_512?: number[];
};

const OPERATING_THRESHOLD = 0.298;

function imgPath(p: string) {
  return "/" + p.replace(/^assets\//, "");
}

// Render a 512-d embedding as a 32×16 colour grid
function EmbeddingHeatmap({ values, label }: { values: number[]; label: string }) {
  const cols = 32;
  const rows = 16;
  const min = Math.min(...values.slice(0, 512));
  const max = Math.max(...values.slice(0, 512));
  const range = max - min || 1;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[10px] text-[var(--text-3)] uppercase tracking-wider font-mono">{label} embedding (512-d)</div>
      <div
        className="rounded-md overflow-hidden border border-[var(--border-c)]"
        style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 0 }}
      >
        {values.slice(0, 512).map((v, i) => {
          const t = (v - min) / range;
          const r = Math.round(t < 0.5 ? t * 2 * 56 + (1 - t * 2) * 10 : 56 + (t - 0.5) * 2 * (248 - 56));
          const g = Math.round(t < 0.5 ? t * 2 * 189 : 189 - (t - 0.5) * 2 * 189);
          const b = Math.round(t < 0.5 ? 248 - t * 2 * (248 - 56) : 56 - (t - 0.5) * 2 * 56);
          return (
            <div
              key={i}
              style={{
                background: `rgb(${r},${g},${b})`,
                width: "100%",
                paddingBottom: `${100 / cols}%`,
                opacity: 0.85,
              }}
              title={`dim ${i}: ${v.toFixed(3)}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[9px] text-[var(--text-3)] font-mono">
        <span>{min.toFixed(2)}</span>
        <span className="text-[var(--accent-c)]">← value range →</span>
        <span>{max.toFixed(2)}</span>
      </div>
    </div>
  );
}

export function MatchingClient() {
  const [pairs, setPairs] = useState<PairScore[]>([]);
  const [embedMap, setEmbedMap] = useState<EmbedMap | null>(null);
  const [examples, setExamples] = useState<MatchExample[]>([]);
  const [threshold, setThreshold] = useState(OPERATING_THRESHOLD);
  const [selectedEx, setSelectedEx] = useState(0);

  useEffect(() => {
    fetch("/data/pair_scores.json").then((r) => r.json()).then(setPairs);
    fetch("/data/embedding_map.json").then((r) => r.json()).then(setEmbedMap);
    fetch("/data/matching_examples.json").then((r) => r.json()).then((d: MatchExample[]) => {
      // Pick a mix: first 3 genuine + first 3 impostor
      const genuine = d.filter((x) => x.label === "genuine").slice(0, 4);
      const impostor = d.filter((x) => x.label === "impostor").slice(0, 4);
      setExamples([...genuine, ...impostor]);
    });
  }, []);

  const { far, frr, histData } = useMemo(() => {
    if (!pairs.length) return { far: 0, frr: 0, histData: [] };
    const genuine = pairs.filter((p) => p.label === "genuine");
    const impostor = pairs.filter((p) => p.label === "impostor");
    const frr = genuine.filter((p) => p.score < threshold).length / genuine.length;
    const far = impostor.filter((p) => p.score >= threshold).length / impostor.length;
    const bins = 40;
    const min = -0.2, max = 1.0;
    const bw = (max - min) / bins;
    const gBins = new Array(bins).fill(0);
    const iBins = new Array(bins).fill(0);
    for (const p of genuine) {
      const b = Math.min(Math.floor((p.score - min) / bw), bins - 1);
      if (b >= 0) gBins[b]++;
    }
    for (const p of impostor) {
      const b = Math.min(Math.floor((p.score - min) / bw), bins - 1);
      if (b >= 0) iBins[b]++;
    }
    const histData = gBins.map((g, i) => ({
      x: +(min + (i + 0.5) * bw).toFixed(3),
      genuine: g,
      impostor: iBins[i],
    }));
    return { far, frr, histData };
  }, [pairs, threshold]);

  const ex = examples[selectedEx];
  const exDecision = ex ? (ex.score >= threshold ? "accept" : "reject") : null;

  const COLORS = [
    "#38BDF8","#818CF8","#34D399","#FBBF24","#FB7185",
    "#A78BFA","#2DD4BF","#F97316","#EC4899","#84CC16",
  ];

  return (
    <div className="px-6 py-10 lg:px-12 lg:py-12 max-w-5xl">
      <div className="mb-8">
        <div className="text-[11px] text-[var(--accent-c)] font-mono uppercase tracking-widest mb-2">Matching In Action</div>
        <h1 className="text-4xl font-bold mb-3" style={{ fontFamily: "var(--font-display)" }}>
          Face → Embedding → Decision
        </h1>
        <p className="text-[var(--text-2)] text-base max-w-2xl">
          A face encodes to 512 numbers. Two embeddings get a cosine similarity score. A tuned threshold decides accept or reject.
        </p>
      </div>

      {/* ── Step 1: Pick a pair ── */}
      <section className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-7 h-7 rounded-full bg-[var(--primary-wash)] text-[var(--accent-c)] text-xs font-bold flex items-center justify-center border border-[var(--accent-c)]/30">
            1
          </div>
          <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-display)" }}>Pick an example pair</h2>
        </div>
        <div className="p-5 rounded-xl border border-[var(--border-c)] bg-[var(--surface)]">
          {/* Selector tabs */}
          <div className="flex flex-wrap gap-2 mb-5">
            {examples.map((e, i) => (
              <button
                key={e.pair_id}
                onClick={() => setSelectedEx(i)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg font-mono transition-colors border"
                style={{
                  background: i === selectedEx ? (e.label === "genuine" ? "var(--accept-zone)" : "var(--reject-zone)") : "var(--surface-2)",
                  borderColor: i === selectedEx ? (e.label === "genuine" ? "var(--accept)" : "var(--reject)") : "var(--border-c)",
                  color: i === selectedEx ? (e.label === "genuine" ? "var(--accept)" : "var(--reject)") : "var(--text-2)",
                }}
              >
                <span>{e.label === "genuine" ? "✓" : "✗"}</span>
                <span>{e.score.toFixed(3)}</span>
                <span className="text-[9px] opacity-60">{e.label.slice(0, 3).toUpperCase()}</span>
              </button>
            ))}
          </div>

          {/* Pair display */}
          {ex && (
            <div className="flex flex-wrap gap-6 items-center">
              {/* Ref image */}
              <div className="flex flex-col items-center gap-2">
                <div className="w-36 h-36 rounded-xl overflow-hidden border-2 border-[var(--border-c)] bg-[var(--surface-2)]">
                  <img
                    src={imgPath(ex.ref_image)}
                    alt="Reference face"
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
                <span className="text-[11px] text-[var(--text-3)] font-mono">reference</span>
              </div>

              {/* Score bridge */}
              <div className="flex flex-col items-center gap-2 min-w-[80px]">
                <div className="text-3xl text-[var(--text-3)]">↔</div>
                <div
                  className="text-lg font-bold font-mono"
                  style={{ color: exDecision === "accept" ? "var(--accept)" : "var(--reject)" }}
                >
                  {ex.score.toFixed(4)}
                </div>
                <div className="text-[10px] text-[var(--text-3)] font-mono">cosine sim</div>
              </div>

              {/* Probe image */}
              <div className="flex flex-col items-center gap-2">
                <div className="w-36 h-36 rounded-xl overflow-hidden border-2 border-[var(--border-c)] bg-[var(--surface-2)]">
                  <img
                    src={imgPath(ex.probe_image)}
                    alt="Probe face"
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
                <span className="text-[11px] text-[var(--text-3)] font-mono">probe</span>
              </div>

              {/* Metadata */}
              <div className="flex flex-col gap-2 min-w-[160px]">
                <div>
                  <div className="text-[10px] text-[var(--text-3)] uppercase tracking-wider mb-0.5">Ground truth</div>
                  <div
                    className="text-sm font-semibold"
                    style={{ color: ex.label === "genuine" ? "var(--accept)" : "var(--reject)" }}
                  >
                    {ex.label}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--text-3)] uppercase tracking-wider mb-0.5">Pair ID</div>
                  <div className="text-xs font-mono text-[var(--text-2)]">{ex.pair_id}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Step 2: Raw embeddings ── */}
      <section className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-7 h-7 rounded-full bg-[var(--primary-wash)] text-[var(--accent-c)] text-xs font-bold flex items-center justify-center border border-[var(--accent-c)]/30">
            2
          </div>
          <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-display)" }}>Raw embeddings</h2>
        </div>
        <div className="p-5 rounded-xl border border-[var(--border-c)] bg-[var(--surface)]">
          <p className="text-xs text-[var(--text-2)] mb-5">
            Each face is compressed into 512 numbers by ArcFace (ResNet-100). The heatmap below shows the full vector — warm = high, cool = low.
            Similar faces produce similar patterns; different people produce visibly different signatures.
          </p>
          {ex?.ref_embedding_512 ? (
            <div className="flex flex-col gap-5">
              <EmbeddingHeatmap values={ex.ref_embedding_512} label="Reference" />
              {ex.probe_embedding_512 && (
                <EmbeddingHeatmap values={ex.probe_embedding_512} label="Probe" />
              )}
              {!ex.probe_embedding_512 && (
                <div className="text-xs text-[var(--text-3)] italic">Probe embedding not stored for this example. Select another pair.</div>
              )}
            </div>
          ) : (
            <div className="text-xs text-[var(--text-3)]">Loading embeddings…</div>
          )}
        </div>
      </section>

      {/* ── Step 3: Decision ── */}
      <section className="mb-10">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-7 h-7 rounded-full bg-[var(--primary-wash)] text-[var(--accent-c)] text-xs font-bold flex items-center justify-center border border-[var(--accent-c)]/30">
            3
          </div>
          <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-display)" }}>Decision</h2>
        </div>
        <div className="p-5 rounded-xl border border-[var(--border-c)] bg-[var(--surface)]">
          {ex && (
            <div className="flex flex-wrap gap-8 items-center">
              {/* Score vs threshold visual */}
              <div className="flex-1 min-w-[220px]">
                <div className="text-xs text-[var(--text-2)] mb-2">Score on the threshold line</div>
                <div className="relative h-10 rounded-lg overflow-hidden mb-2" style={{
                  background: `linear-gradient(to right, var(--reject-zone) 0%, var(--uncertain-zone) 45%, var(--accept-zone) 100%)`
                }}>
                  {/* Threshold marker */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-[var(--accent-c)]"
                    style={{ left: `${((OPERATING_THRESHOLD + 0.2) / 1.2) * 100}%` }}
                  />
                  {/* Score marker */}
                  <div
                    className="absolute top-1 bottom-1 w-1.5 h-8 rounded"
                    style={{
                      left: `calc(${((ex.score + 0.2) / 1.2) * 100}% - 3px)`,
                      background: exDecision === "accept" ? "var(--accept)" : "var(--reject)",
                      boxShadow: `0 0 8px ${exDecision === "accept" ? "var(--accept)" : "var(--reject)"}`,
                    }}
                  />
                  <div className="absolute inset-0 flex items-center justify-between px-3 text-[10px] text-[var(--text-3)] pointer-events-none">
                    <span>REJECT</span><span>θ</span><span>ACCEPT</span>
                  </div>
                </div>
                <div className="flex gap-4 text-xs font-mono">
                  <span><span className="text-[var(--text-3)]">score: </span><span style={{ color: exDecision === "accept" ? "var(--accept)" : "var(--reject)" }}>{ex.score.toFixed(4)}</span></span>
                  <span><span className="text-[var(--text-3)]">θ: </span><span className="text-[var(--accent-c)]">{OPERATING_THRESHOLD.toFixed(4)}</span></span>
                </div>
              </div>

              {/* Verdict */}
              <div className="flex flex-col gap-2 items-start">
                <div
                  className="text-3xl font-bold px-6 py-3 rounded-xl"
                  style={{
                    background: exDecision === "accept" ? "var(--accept-zone)" : "var(--reject-zone)",
                    color: exDecision === "accept" ? "var(--accept)" : "var(--reject)",
                    border: `2px solid ${exDecision === "accept" ? "var(--accept)" : "var(--reject)"}`,
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {exDecision?.toUpperCase()}
                </div>
                <div className="text-[11px] text-[var(--text-3)]">
                  {ex.score.toFixed(4)} {ex.score >= threshold ? "≥" : "<"} {threshold.toFixed(4)} → {exDecision}
                </div>
                <div className="text-[11px]" style={{ color: ex.label === "genuine" ? "var(--accept)" : "var(--reject)" }}>
                  Ground truth: {ex.label} · {exDecision === "accept" && ex.label === "genuine" ? "✓ correct" :
                    exDecision === "reject" && ex.label === "impostor" ? "✓ correct" : "✗ error"}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Live threshold slider ── */}
      <section className="mb-8 p-5 rounded-xl border border-[var(--border-c)] bg-[var(--surface)]">
        <h2 className="text-base font-semibold mb-1" style={{ fontFamily: "var(--font-display)" }}>
          Threshold slider — live FAR / FRR
        </h2>
        <p className="text-xs text-[var(--text-2)] mb-4">
          Move the slider to see how the threshold trades off false accepts (impostors accepted) vs false rejects (genuine users turned away).
        </p>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <div className="flex gap-6 text-sm font-mono">
            <span>
              <span className="text-[var(--text-3)]">FAR </span>
              <span className="text-[var(--reject)] font-bold">{(far * 100).toFixed(2)}%</span>
            </span>
            <span>
              <span className="text-[var(--text-3)]">FRR </span>
              <span className="text-[var(--uncertain)] font-bold">{(frr * 100).toFixed(2)}%</span>
            </span>
            <span>
              <span className="text-[var(--text-3)]">θ </span>
              <span className="text-[var(--accent-c)] font-bold">{threshold.toFixed(4)}</span>
            </span>
          </div>
          <button
            onClick={() => setThreshold(OPERATING_THRESHOLD)}
            className="text-[10px] text-[var(--accent-c)] font-mono hover:underline"
          >
            reset to operating ({OPERATING_THRESHOLD.toFixed(4)})
          </button>
        </div>

        {/* Number line */}
        <div className="relative h-9 rounded-lg overflow-hidden mb-2" style={{
          background: `linear-gradient(to right, var(--reject-zone) 0%, var(--uncertain-zone) 45%, var(--accept-zone) 100%)`
        }}>
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-[var(--foreground)] opacity-70"
            style={{ left: `${((threshold + 0.2) / 1.2) * 100}%`, boxShadow: "0 0 8px var(--primary-glow)" }}
          />
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-[var(--accent-c)]"
            style={{ left: `${((OPERATING_THRESHOLD + 0.2) / 1.2) * 100}%` }}
          />
          <div className="absolute inset-0 flex items-center justify-between px-3 text-[10px] text-[var(--text-3)] pointer-events-none">
            <span>REJECT</span><span>UNCERTAIN</span><span>ACCEPT</span>
          </div>
        </div>
        <input
          type="range" min={-0.2} max={1.0} step={0.002} value={threshold}
          onChange={(e) => setThreshold(+e.target.value)}
          className="w-full accent-[var(--accent-c)]"
        />
        <div className="flex justify-between text-[10px] text-[var(--text-3)] font-mono mt-0.5">
          <span>−0.20</span><span className="text-[var(--accent-c)]">operating: {OPERATING_THRESHOLD.toFixed(4)}</span><span>1.00</span>
        </div>
      </section>

      {/* Score distribution histogram */}
      {histData.length > 0 && (
        <section className="mb-8 p-5 rounded-xl border border-[var(--border-c)] bg-[var(--surface)]">
          <h2 className="text-base font-semibold mb-1" style={{ fontFamily: "var(--font-display)" }}>Score distribution</h2>
          <p className="text-xs text-[var(--text-2)] mb-4">
            Green = genuine pairs · Red = impostor pairs · Dashed line = threshold.
            A good matcher pushes these two distributions apart.
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={histData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-c)" opacity={0.4} />
              <XAxis dataKey="x" tick={{ fill: "var(--text-3)", fontSize: 10 }} tickFormatter={(v) => v.toFixed(2)} />
              <YAxis tick={{ fill: "var(--text-3)", fontSize: 10 }} />
              <Tooltip
                contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border-c)", borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: "var(--text-2)" }}
              />
              <Bar dataKey="genuine" fill="#34D399" opacity={0.75} name="Genuine" />
              <Bar dataKey="impostor" fill="#FB7185" opacity={0.75} name="Impostor" />
              <ReferenceLine x={+threshold.toFixed(3)} stroke="var(--accent-c)" strokeWidth={2} strokeDasharray="4 2" />
            </BarChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* 2D Embedding map */}
      {embedMap && (
        <section className="p-5 rounded-xl border border-[var(--border-c)] bg-[var(--surface)]">
          <h2 className="text-base font-semibold mb-1" style={{ fontFamily: "var(--font-display)" }}>2D embedding map</h2>
          <p className="text-xs text-[var(--text-2)] mb-4">
            512-d embeddings projected to 2D via PCA ({((embedMap.explained_variance[0] + embedMap.explained_variance[1]) * 100).toFixed(1)}% variance explained).
            Each dot = one face image. Same identity → same colour → they cluster together.
          </p>
          <ResponsiveContainer width="100%" height={360}>
            <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-c)" opacity={0.25} />
              <XAxis type="number" dataKey="x" name="PC1" tick={{ fill: "var(--text-3)", fontSize: 10 }} domain={["auto", "auto"]} />
              <YAxis type="number" dataKey="y" name="PC2" tick={{ fill: "var(--text-3)", fontSize: 10 }} domain={["auto", "auto"]} />
              <Tooltip
                cursor={{ strokeDasharray: "3 3", stroke: "var(--border-c)" }}
                content={({ payload }) => {
                  if (!payload?.length) return null;
                  const d = payload[0].payload as EmbedPoint;
                  return (
                    <div style={{ background: "var(--surface-2)", border: "1px solid var(--border-c)", borderRadius: 8, padding: "8px 12px", fontSize: 11 }}>
                      <div style={{ color: "var(--text-2)" }}>ID <span style={{ color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>{d.identity}</span></div>
                      <div style={{ color: "var(--text-2)" }}>{d.gender} · {d.age}</div>
                    </div>
                  );
                }}
              />
              <Scatter data={embedMap.points} isAnimationActive={false}>
                {embedMap.points.map((pt, idx) => (
                  <Cell key={idx} fill={COLORS[parseInt(pt.identity) % COLORS.length]} opacity={0.65} r={3} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </section>
      )}
    </div>
  );
}
