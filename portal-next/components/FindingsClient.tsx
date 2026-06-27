"use client";
import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ReferenceLine, Legend, BarChart, Bar, ScatterChart, Scatter, Cell,
} from "recharts";

// ─── Types ──────────────────────────────────────────────────────────
type Overall = { far: number; frr: number; eer: number; auc: number; tar_at_far: Record<string, number | null> };
type RocPt = { threshold: number; far: number; frr: number; tar: number };
type Group = { group: string; frr: number; far: number; n_pairs: number };
type CalibBin = { conf: number; acc: number; n: number };
type Calib = { ece: number; bins: CalibBin[] } | null;
type Cost = { calls: number; tokens_in: number; tokens_out: number; usd_total: number; usd_per_decision: number };
type Lat = { p50: number; p95: number };
type Matcher = {
  matcher_id: string; task_type: string; operating_threshold: number;
  overall: Overall; roc: RocPt[]; by_group: Group[];
  disparity_ratio: number | null; calibration: Calib; cost: Cost; latency_ms: Lat;
};
type DisagEx = { pair_id: string; arcface_score: number; vlm_decision: boolean; label: string };
type Disag = { uncertain_band: [number,number]; n_in_band: number; vlm_correct_in_band: number; examples: DisagEx[] };
type Run = { id: string; timestamp: string; git_sha: string; config_hash: string; corpus_version?: string; vlm_mode?: string };
type EvalRun = { schema_version: string; run: Run; matchers: Matcher[]; disagreement: Disag };

// ─── Constants ──────────────────────────────────────────────────────
const MC: Record<string, string> = {
  arcface: "#38BDF8", insightface: "#818CF8",
  vlm_claude: "#FBBF24", pad_baseline: "#34D399", pad_vlm: "#FB7185",
};
const ML: Record<string, string> = {
  arcface: "ArcFace", insightface: "InsightFace",
  vlm_claude: "Claude VLM", pad_baseline: "PAD Baseline", pad_vlm: "PAD VLM",
};
const TABS = ["Overview","Matching","Bias","Calibration","Cost & Latency","Disagreement"];

function pct(n: number | null | undefined) { return n == null ? "—" : (n * 100).toFixed(2) + "%"; }
function usd(n: number) { return "$" + n.toFixed(4); }
function fmt(n: number | null | undefined, d = 4) { return n == null ? "—" : n.toFixed(d); }
function latFmt(ms: number) { return ms === 0 ? "—" : ms >= 1000 ? (ms/1000).toFixed(1)+"s" : ms+"ms"; }
function qualEer(v: number) { return v < 0.05 ? "var(--accept)" : v < 0.15 ? "var(--uncertain)" : "var(--reject)"; }
function qualAuc(v: number) { return v > 0.97 ? "var(--accept)" : v > 0.90 ? "var(--uncertain)" : "var(--reject)"; }

function Card({ children, full, className = "" }: { children: React.ReactNode; full?: boolean; className?: string }) {
  return (
    <div className={`p-5 rounded-xl border border-[var(--border-c)] bg-[var(--surface)] ${full ? "col-span-full" : ""} ${className}`}>
      {children}
    </div>
  );
}
function KpiGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-5">{children}</div>;
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
const downsample = (arr: RocPt[], n: number) => {
  const step = Math.max(1, Math.floor(arr.length / n));
  return arr.filter((_, i) => i % step === 0);
};

// ─── Tab components ──────────────────────────────────────────────────
function TabOverview({ data }: { data: EvalRun }) {
  const r = data.run;
  const matchMatchers = data.matchers.filter((m) => m.task_type === "match");
  const dg = data.disagreement;
  const dgPct = dg.n_in_band > 0 ? ((dg.vlm_correct_in_band / dg.n_in_band) * 100).toFixed(1) + "%" : "—";

  return (
    <div className="flex flex-col gap-6">
      {/* Run metadata */}
      <Card>
        <h3 className="text-sm font-semibold text-[var(--text-2)] uppercase tracking-wider mb-3">Run metadata</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-2 text-sm font-mono">
          {[
            ["ID", r.id.slice(0,16) + "…"],
            ["Timestamp", r.timestamp.slice(0,19).replace("T"," ")],
            ["Git SHA", r.git_sha],
            ["Config hash", r.config_hash?.slice(0,12) ?? "—"],
            ["Corpus", r.corpus_version?.slice(0,12) ?? "—"],
            ["VLM mode", r.vlm_mode ?? "—"],
          ].map(([k,v]) => (
            <div key={k}>
              <span className="text-[var(--text-3)]">{k}: </span>
              <span className="text-[var(--foreground)]">{v}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Matcher summary table */}
      <Card>
        <h3 className="text-sm font-semibold text-[var(--text-2)] uppercase tracking-wider mb-3">Matcher summary</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-c)] text-[10px] text-[var(--text-3)] uppercase tracking-wider">
                {["Matcher","EER","AUC","FAR @op","FRR @op","TAR@1%","TAR@0.1%","Cost USD","p50","p95"].map(h => (
                  <th key={h} className="text-left py-2 pr-4 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.matchers.map((m) => {
                const o = m.overall;
                return (
                  <tr key={m.matcher_id} className="border-b border-[var(--border-c)] hover:bg-[var(--surface-2)]">
                    <td className="py-2 pr-4">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ background: MC[m.matcher_id] ?? "#888" }} />
                        <span className="font-medium text-xs">{ML[m.matcher_id] ?? m.matcher_id}</span>
                      </span>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs" style={{ color: qualEer(o.eer) }}>{pct(o.eer)}</td>
                    <td className="py-2 pr-4 font-mono text-xs" style={{ color: qualAuc(o.auc) }}>{fmt(o.auc)}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-[var(--text-2)]">{pct(o.far)}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-[var(--text-2)]">{pct(o.frr)}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-[var(--text-2)]">{pct(o.tar_at_far["1e-2"])}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-[var(--text-2)]">{pct(o.tar_at_far["1e-3"])}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-[var(--text-2)]">{usd(m.cost.usd_total)}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-[var(--text-2)]">{latFmt(m.latency_ms.p50)}</td>
                    <td className="py-2 font-mono text-xs text-[var(--text-2)]">{latFmt(m.latency_ms.p95)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-col gap-1.5 text-[11px] text-[var(--text-3)]">
          <div><span className="font-mono text-[var(--uncertain)]">pad_baseline</span> — no usable signal on synthetic data (AUC 0.47). Pixel-level texture features are near-random on DigiFace-1M renders; this row establishes the floor.</div>
          <div><span className="font-mono text-[var(--uncertain)]">pad_vlm</span> — obvious simulated attacks only — a floor, not a real-world number. Performance reflects rendered print/screen artefacts, not physical PAI.</div>
        </div>
      </Card>

      {/* Disagreement headline */}
      <Card>
        <h3 className="text-sm font-semibold text-[var(--text-2)] uppercase tracking-wider mb-3">Disagreement headline</h3>
        <KpiGrid>
          <Kpi label="Pairs in uncertain band" value={String(dg.n_in_band)}
            sub={`ArcFace score in [${dg.uncertain_band[0].toFixed(3)}, ${dg.uncertain_band[1].toFixed(3)}]`} color="var(--accent-c)" />
          <Kpi label="VLM correct in band" value={String(dg.vlm_correct_in_band)} color="var(--accept)" />
          <Kpi label="VLM accuracy in band" value={dgPct} sub="where VLM earns its tokens" color="var(--accept)" />
          <Kpi label="Schema version" value={data.schema_version} color="var(--text-2)" />
        </KpiGrid>
      </Card>
    </div>
  );
}

function TabMatching({ data }: { data: EvalRun }) {
  const matchers = data.matchers;

  // ROC: scatter (multiple series)
  const rocSeries = matchers.map((m) => ({
    id: m.matcher_id,
    data: downsample(m.roc, 60).map((p) => ({ x: +p.far.toFixed(4), y: +p.tar.toFixed(4) })),
  }));

  // DET: scatter (FRR vs FAR)
  const detSeries = matchers.map((m) => ({
    id: m.matcher_id,
    data: downsample(m.roc, 60)
      .filter((p) => p.far > 0 && p.frr > 0)
      .map((p) => ({ x: +p.far.toFixed(4), y: +p.frr.toFixed(4) })),
  }));

  // Threshold chart: arcface
  const arc = matchers.find((m) => m.matcher_id === "arcface") ?? matchers[0];
  const threshData = downsample(arc.roc, 120)
    .sort((a, b) => a.threshold - b.threshold)
    .map((p) => ({
      t: +p.threshold.toFixed(4),
      FAR: +(p.far * 100).toFixed(2),
      FRR: +(p.frr * 100).toFixed(2),
      TAR: +(p.tar * 100).toFixed(2),
    }));

  const tooltipStyle = { background: "var(--surface-2)", border: "1px solid var(--border-c)", borderRadius: 8, fontSize: 11 };

  return (
    <div className="flex flex-col gap-6">
      <div className="grid lg:grid-cols-2 gap-6">
        {/* ROC */}
        <Card>
          <h3 className="text-sm font-semibold mb-1">ROC — TAR vs FAR</h3>
          <p className="text-xs text-[var(--text-2)] mb-3">Top-left is ideal. Diagonal = random.</p>
          <ResponsiveContainer width="100%" height={260}>
            <ScatterChart margin={{ top: 4, right: 4, bottom: 16, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-c)" opacity={0.25} />
              <XAxis type="number" dataKey="x" name="FAR" domain={[0,1]} tick={{ fill:"var(--text-3)", fontSize:10 }}
                label={{ value:"FAR", position:"insideBottom", offset:-8, fill:"var(--text-3)", fontSize:10 }} />
              <YAxis type="number" dataKey="y" name="TAR" domain={[0,1]} tick={{ fill:"var(--text-3)", fontSize:10 }}
                label={{ value:"TAR", angle:-90, position:"insideLeft", fill:"var(--text-3)", fontSize:10 }} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => typeof v === "number" ? v.toFixed(4) : v} />
              <ReferenceLine segment={[{x:0,y:0},{x:1,y:1}]} stroke="var(--border-c)" strokeDasharray="4 2" />
              {rocSeries.map(({ id, data }) => (
                <Scatter key={id} name={ML[id]??id} data={data} fill={MC[id]??"#888"} opacity={0.8} r={2} isAnimationActive={false} />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-3 mt-2">
            {matchers.map((m) => (
              <span key={m.matcher_id} className="flex items-center gap-1.5 text-[10px] text-[var(--text-2)]">
                <span className="w-3 h-0.5 rounded" style={{ background: MC[m.matcher_id]??"#888", display:"inline-block" }} />
                {ML[m.matcher_id]??m.matcher_id} (AUC {fmt(m.overall.auc)})
              </span>
            ))}
          </div>
        </Card>

        {/* DET */}
        <Card>
          <h3 className="text-sm font-semibold mb-1">DET — FRR vs FAR</h3>
          <p className="text-xs text-[var(--text-2)] mb-3">Detection Error Tradeoff. Bottom-left is ideal.</p>
          <ResponsiveContainer width="100%" height={260}>
            <ScatterChart margin={{ top: 4, right: 4, bottom: 16, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-c)" opacity={0.25} />
              <XAxis type="number" dataKey="x" name="FAR" domain={[0,1]} tick={{ fill:"var(--text-3)", fontSize:10 }}
                label={{ value:"FAR", position:"insideBottom", offset:-8, fill:"var(--text-3)", fontSize:10 }} />
              <YAxis type="number" dataKey="y" name="FRR" domain={[0,1]} tick={{ fill:"var(--text-3)", fontSize:10 }}
                label={{ value:"FRR", angle:-90, position:"insideLeft", fill:"var(--text-3)", fontSize:10 }} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => typeof v === "number" ? v.toFixed(4) : v} />
              {detSeries.map(({ id, data }) => (
                <Scatter key={id} name={ML[id]??id} data={data} fill={MC[id]??"#888"} opacity={0.8} r={2} isAnimationActive={false} />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* FAR/FRR/TAR vs threshold */}
      <Card>
        <h3 className="text-sm font-semibold mb-1">FAR / FRR / TAR vs Threshold — {ML[arc.matcher_id]??arc.matcher_id}</h3>
        <p className="text-xs text-[var(--text-2)] mb-3">Operating threshold: {arc.operating_threshold.toFixed(4)}</p>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={threshData} margin={{ top: 4, right: 8, bottom: 4, left: -10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-c)" opacity={0.3} />
            <XAxis dataKey="t" tick={{ fill:"var(--text-3)", fontSize:10 }}
              label={{ value:"Threshold", position:"insideBottom", offset:-4, fill:"var(--text-3)", fontSize:10 }} />
            <YAxis tick={{ fill:"var(--text-3)", fontSize:10 }} unit="%" domain={[0,100]} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize:11, color:"var(--text-2)" }} />
            <Line type="monotone" dataKey="FAR" stroke="var(--reject)" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="FRR" stroke="var(--uncertain)" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="TAR" stroke="var(--accept)" dot={false} strokeWidth={2} />
            <ReferenceLine x={+arc.operating_threshold.toFixed(4)} stroke="var(--accent-c)" strokeDasharray="4 2"
              label={{ value:"θ", fill:"var(--accent-c)", fontSize:10 }} />
          </LineChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

function TabBias({ data }: { data: EvalRun }) {
  const arc = data.matchers.find((m) => m.matcher_id === "arcface") ?? data.matchers[0];
  const tooltipStyle = { background: "var(--surface-2)", border: "1px solid var(--border-c)", borderRadius: 8, fontSize: 11 };

  // Drop skin axis — ITA on DigiFace-1M synthetic faces produced a degenerate split
  // (9712 dark / 38 light). Showing it would look broken and the signal is noise.
  const sexGroups = arc.by_group.filter((g) => g.group.startsWith("sex:"));
  const ageGroups = arc.by_group.filter((g) => g.group.startsWith("age:"));

  const sexFrrData = sexGroups.map((g) => ({ name: g.group.replace("sex:", ""), frr: +(g.frr * 100).toFixed(2), n: g.n_pairs }));
  const ageFrrData = ageGroups.map((g) => ({
    name: g.group.replace("age:", "") + (g.n_pairs < 100 ? " *" : ""),
    frr: +(g.frr * 100).toFixed(2),
    n: g.n_pairs,
  }));

  // Disparity ratio computed over sex + age only (skin excluded)
  const visibleGroups = [...sexGroups, ...ageGroups];
  const frrs = visibleGroups.map((g) => g.frr).filter((v) => v > 0);
  const drFiltered = frrs.length >= 2 ? Math.max(...frrs) / Math.min(...frrs) : null;
  const drColor = drFiltered == null ? "var(--text-2)" : drFiltered > 2 ? "var(--reject)" : drFiltered > 1.5 ? "var(--uncertain)" : "var(--accept)";

  return (
    <div className="flex flex-col gap-6">
      <Caveat text="Corpus is ~87% male — Female bucket has ~⅕ the pairs. ~25 identities per age bucket gives trend-level signal only, not tight confidence intervals. Thin buckets (marked *) have fewer than 100 pairs." />
      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <h3 className="text-sm font-semibold mb-1">FRR by sex (@ operating threshold)</h3>
          <p className="text-xs text-[var(--text-2)] mb-3">Female FRR is higher — consistent with an ~87% male training corpus.</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={sexFrrData} margin={{ top:4, right:8, bottom:20, left:-10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-c)" opacity={0.3} />
              <XAxis dataKey="name" tick={{ fill:"var(--text-3)", fontSize:10 }} />
              <YAxis tick={{ fill:"var(--text-3)", fontSize:10 }} unit="%" />
              <Tooltip contentStyle={tooltipStyle} formatter={(v, _, p) => [`${v}% (n=${p.payload.n})`, "FRR"]} />
              <Bar dataKey="frr" name="FRR %" fill="var(--uncertain)" opacity={0.8} radius={[4,4,0,0]} />
              <ReferenceLine y={+(arc.overall.frr * 100).toFixed(2)} stroke="var(--accent-c)" strokeDasharray="4 2"
                label={{ value:"overall", fill:"var(--accent-c)", fontSize:9 }} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <h3 className="text-sm font-semibold mb-1">FRR by age (@ operating threshold)</h3>
          <p className="text-xs text-[var(--text-2)] mb-3">* under_25 bucket has &lt;100 pairs — directional only.</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={ageFrrData} margin={{ top:4, right:8, bottom:20, left:-10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-c)" opacity={0.3} />
              <XAxis dataKey="name" tick={{ fill:"var(--text-3)", fontSize:9 }} />
              <YAxis tick={{ fill:"var(--text-3)", fontSize:10 }} unit="%" />
              <Tooltip contentStyle={tooltipStyle} formatter={(v, _, p) => [`${v}% (n=${p.payload.n})`, "FRR"]} />
              <Bar dataKey="frr" name="FRR %" fill="var(--uncertain)" opacity={0.8} radius={[4,4,0,0]} />
              <ReferenceLine y={+(arc.overall.frr * 100).toFixed(2)} stroke="var(--accent-c)" strokeDasharray="4 2"
                label={{ value:"overall", fill:"var(--accent-c)", fontSize:9 }} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
      <Card>
        <h3 className="text-sm font-semibold mb-3">Disparity ratio (worst FRR ÷ best FRR, sex + age only)</h3>
        <KpiGrid>
          <Kpi label="Disparity ratio" value={drFiltered == null ? "— (best=0)" : drFiltered.toFixed(2)+"×"} color={drColor}
            sub="sex + age axes; skin excluded" />
          <Kpi label="Operating threshold" value={arc.operating_threshold.toFixed(4)} color="var(--accent-c)" />
          <Kpi label="Sex pairs" value={`${sexGroups.find(g=>g.group==="sex:Female")?.n_pairs ?? 0}F / ${sexGroups.find(g=>g.group==="sex:Male")?.n_pairs ?? 0}M`} color="var(--text-2)" sub="imbalanced corpus" />
          <Kpi label="Fairness target" value="< 2×" color="var(--accept)" sub="ISO/IEC 19795 guidance" />
        </KpiGrid>
        <p className="text-xs text-[var(--text-2)] mb-2">A ratio &gt;2× warrants investigation. Sex disparity is real and attributable to corpus imbalance, not a measurement artefact.</p>
        <p className="text-xs text-[var(--text-3)] italic">Skin-tone axis not shown: ITA labeling on DigiFace-1M synthetic faces produced a degenerate result (98% dark, 2% light). Labels on synthetic CGI faces are too skewed to support a skin-tone claim, so I don't make one.</p>
      </Card>
    </div>
  );
}

function TabCalibration({ data }: { data: EvalRun }) {
  const vlm = data.matchers.find((m) => m.matcher_id === "vlm_claude");
  const tooltipStyle = { background: "var(--surface-2)", border: "1px solid var(--border-c)", borderRadius: 8, fontSize: 11 };

  if (!vlm?.calibration) {
    return (
      <Card>
        <InfoBanner text="Calibration is computed for VLM matchers only." />
        <p className="text-sm text-[var(--text-2)]">No VLM calibration data in this run.</p>
      </Card>
    );
  }
  const cal = vlm.calibration;
  const calibData = cal.bins.map((b) => ({ conf: +(b.conf * 100).toFixed(1), acc: +(b.acc * 100).toFixed(1), n: b.n }));
  const eceColor = cal.ece < 0.05 ? "var(--accept)" : cal.ece < 0.15 ? "var(--uncertain)" : "var(--reject)";

  return (
    <div className="flex flex-col gap-6">
      <InfoBanner text="Calibration is computed for VLM matchers only. A perfectly calibrated model's reliability curve follows the diagonal — confidence = accuracy." />
      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <h3 className="text-sm font-semibold mb-1">Reliability diagram — Claude VLM</h3>
          <p className="text-xs text-[var(--text-2)] mb-3">Bars = empirical accuracy per confidence bin. Dashed = perfect calibration.</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={calibData} margin={{ top:4, right:8, bottom:4, left:-10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-c)" opacity={0.3} />
              <XAxis dataKey="conf" tick={{ fill:"var(--text-3)", fontSize:10 }} unit="%" />
              <YAxis tick={{ fill:"var(--text-3)", fontSize:10 }} unit="%" domain={[0,100]} />
              <Tooltip contentStyle={tooltipStyle}
                formatter={(v, name) => [v + "%", name === "acc" ? "Accuracy" : "n"]} />
              <Bar dataKey="acc" name="Accuracy %" fill={MC.vlm_claude} opacity={0.85} radius={[4,4,0,0]} />
              <ReferenceLine segment={[{x:60,y:60},{x:100,y:100}]} stroke="var(--border-c)" strokeDasharray="4 2" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <h3 className="text-sm font-semibold mb-3">ECE summary</h3>
          <KpiGrid>
            <Kpi label="ECE" value={(cal.ece * 100).toFixed(2) + "%"} color={eceColor} sub="lower is better; 0 = perfect" />
            <Kpi label="Calib bins" value={String(cal.bins.length)} color="var(--text-2)" />
            <Kpi label="VLM EER" value={pct(vlm.overall.eer)} color="var(--accept)" />
            <Kpi label="VLM AUC" value={fmt(vlm.overall.auc)} color="var(--accent-c)" />
          </KpiGrid>
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-[var(--border-c)] text-[var(--text-3)]">
                  <th className="text-left py-1.5 pr-4 font-normal">Conf bin</th>
                  <th className="text-right py-1.5 pr-4 font-normal">Accuracy</th>
                  <th className="text-right py-1.5 font-normal">n pairs</th>
                </tr>
              </thead>
              <tbody>
                {cal.bins.map((b, i) => (
                  <tr key={i} className="border-b border-[var(--border-c)] text-[var(--text-2)]">
                    <td className="py-1.5 pr-4">{(b.conf * 100).toFixed(1)}%</td>
                    <td className="py-1.5 pr-4 text-right">{(b.acc * 100).toFixed(1)}%</td>
                    <td className="py-1.5 text-right">{b.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function TabCost({ data }: { data: EvalRun }) {
  const matchers = data.matchers;
  const labels = matchers.map((m) => ML[m.matcher_id] ?? m.matcher_id);
  const tooltipStyle = { background: "var(--surface-2)", border: "1px solid var(--border-c)", borderRadius: 8, fontSize: 11 };
  const costData = matchers.map((m, i) => ({ name: labels[i], total: m.cost.usd_total, per: m.cost.usd_per_decision }));
  const latData = matchers.map((m, i) => ({ name: labels[i], p50: m.latency_ms.p50, p95: m.latency_ms.p95 }));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <h3 className="text-sm font-semibold mb-3">Cost per matcher</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={costData} margin={{ top:4, right:8, bottom:4, left:-10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-c)" opacity={0.3} />
              <XAxis dataKey="name" tick={{ fill:"var(--text-3)", fontSize:10 }} />
              <YAxis tick={{ fill:"var(--text-3)", fontSize:10 }} tickFormatter={(v) => "$"+v.toFixed(2)} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => typeof v === "number" ? "$" + v.toFixed(4) : v} />
              <Legend wrapperStyle={{ fontSize:11, color:"var(--text-2)" }} />
              <Bar dataKey="total" name="Total USD" fill={MC.arcface} opacity={0.85} radius={[4,4,0,0]} />
              <Bar dataKey="per" name="USD/decision" fill={MC.vlm_claude} opacity={0.85} radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <h3 className="text-sm font-semibold mb-3">Latency p50 / p95</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={latData} margin={{ top:4, right:8, bottom:4, left:-10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-c)" opacity={0.3} />
              <XAxis dataKey="name" tick={{ fill:"var(--text-3)", fontSize:10 }} />
              <YAxis tick={{ fill:"var(--text-3)", fontSize:10 }} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => typeof v === "number" ? v+"ms" : v} />
              <Legend wrapperStyle={{ fontSize:11, color:"var(--text-2)" }} />
              <Bar dataKey="p50" name="p50 ms" fill="var(--accept)" opacity={0.85} radius={[4,4,0,0]} />
              <Bar dataKey="p95" name="p95 ms" fill="var(--uncertain)" opacity={0.85} radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
      <Card>
        <h3 className="text-sm font-semibold mb-3">Cost detail</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-[var(--border-c)] text-[10px] text-[var(--text-3)] uppercase tracking-wider">
                {["Matcher","Calls","Tokens in","Tokens out","USD total","USD/decision","p50","p95"].map(h => (
                  <th key={h} className="text-left py-2 pr-4 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matchers.map((m) => (
                <tr key={m.matcher_id} className="border-b border-[var(--border-c)] text-[var(--text-2)] hover:bg-[var(--surface-2)]">
                  <td className="py-2 pr-4">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ background: MC[m.matcher_id]??"#888" }} />
                      {ML[m.matcher_id]??m.matcher_id}
                    </span>
                  </td>
                  <td className="py-2 pr-4">{m.cost.calls.toLocaleString()}</td>
                  <td className="py-2 pr-4">{m.cost.tokens_in.toLocaleString()}</td>
                  <td className="py-2 pr-4">{m.cost.tokens_out.toLocaleString()}</td>
                  <td className="py-2 pr-4 text-[var(--foreground)]">{usd(m.cost.usd_total)}</td>
                  <td className="py-2 pr-4">{usd(m.cost.usd_per_decision)}</td>
                  <td className="py-2 pr-4">{latFmt(m.latency_ms.p50)}</td>
                  <td className="py-2">{latFmt(m.latency_ms.p95)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function TabDisagreement({ data }: { data: EvalRun }) {
  const dg = data.disagreement;
  const dgPct = dg.n_in_band > 0 ? ((dg.vlm_correct_in_band / dg.n_in_band) * 100).toFixed(1) + "%" : "—";

  return (
    <div className="flex flex-col gap-6">
      <InfoBanner text="Of pairs where ArcFace is uncertain (score in the uncertain band), how often does the VLM second opinion get it right? This is where VLM tokens earn their cost." />
      <KpiGrid>
        <Kpi label="Uncertain band" value={`[${dg.uncertain_band[0].toFixed(3)}, ${dg.uncertain_band[1].toFixed(3)}]`}
          sub="ArcFace cosine score" color="var(--accent-c)" />
        <Kpi label="Pairs in band" value={String(dg.n_in_band)} sub="ArcFace ambiguous zone" color="var(--accent-2)" />
        <Kpi label="VLM correct" value={String(dg.vlm_correct_in_band)} color="var(--accept)" />
        <Kpi label="VLM accuracy in band" value={dgPct} color="var(--accept)" sub="second-opinion precision" />
      </KpiGrid>
      <Card>
        <h3 className="text-sm font-semibold mb-4">Example pairs in uncertain band</h3>
        {!dg.examples?.length ? (
          <p className="text-sm text-[var(--text-2)]">No example pairs stored — VLM may not have covered any pairs in the uncertain band.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {dg.examples.map((ex) => {
              const vlmCorrect = ex.label === "genuine" ? ex.vlm_decision : !ex.vlm_decision;
              return (
                <div
                  key={ex.pair_id}
                  className="p-3 rounded-lg border text-xs font-mono"
                  style={{
                    borderColor: vlmCorrect ? "var(--accept)" : "var(--reject)",
                    borderLeftWidth: 3,
                    background: "var(--surface-2)",
                  }}
                >
                  <div className="text-[var(--text-3)] mb-1.5">{ex.pair_id}</div>
                  <div className="flex flex-wrap gap-6">
                    <div><span className="text-[var(--text-3)]">Label </span><span className="text-[var(--foreground)]">{ex.label}</span></div>
                    <div><span className="text-[var(--text-3)]">ArcFace </span><span className="text-[var(--foreground)]">{ex.arcface_score.toFixed(4)}</span></div>
                    <div><span className="text-[var(--text-3)]">VLM </span><span style={{ color: ex.vlm_decision ? "var(--accept)" : "var(--reject)" }}>{ex.vlm_decision ? "✓ same" : "✗ different"}</span></div>
                    <div><span className="text-[var(--text-3)]">Call </span><span style={{ color: vlmCorrect ? "var(--accept)" : "var(--reject)" }}>{vlmCorrect ? "correct" : "wrong"}</span></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────
export function FindingsClient() {
  const [data, setData] = useState<EvalRun | null>(null);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    fetch("/data/eval_run.json").then((r) => r.json()).then(setData);
  }, []);

  if (!data) {
    return (
      <div className="px-6 py-10">
        <div className="text-[var(--text-2)] text-sm animate-pulse">Loading eval data…</div>
      </div>
    );
  }

  const matchMatchers = data.matchers.filter((m) => m.task_type === "match");

  return (
    <div className="px-6 py-10 lg:px-12 lg:py-12 max-w-6xl">
      {/* Page header */}
      <div className="mb-6">
        <div className="text-[11px] text-[var(--accent-c)] font-mono uppercase tracking-widest mb-2">Face Auth · Eval &amp; Findings</div>
        <h1 className="text-4xl font-bold mb-2" style={{ fontFamily: "var(--font-display)" }}>
          Eval Dashboard
        </h1>
        <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-[var(--text-3)]">
          <span>run {data.run.id.slice(0,8)}</span>
          <span>·</span>
          <span>git {data.run.git_sha}</span>
          <span>·</span>
          <span>{data.run.timestamp.slice(0,10)}</span>
          <span>·</span>
          <span>schema v{data.schema_version}</span>
        </div>
      </div>

      {/* Hero KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {matchMatchers.map((m) => (
          <div key={m.matcher_id} className="p-4 rounded-xl border border-[var(--border-c)] bg-[var(--surface)]">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="w-2 h-2 rounded-full" style={{ background: MC[m.matcher_id] }} />
              <span className="text-[10px] text-[var(--text-3)] uppercase tracking-wider">{ML[m.matcher_id]}</span>
            </div>
            <div className="text-2xl font-bold font-mono mb-0.5" style={{ color: qualAuc(m.overall.auc) }}>
              {m.overall.auc.toFixed(4)}
            </div>
            <div className="text-[10px] text-[var(--text-3)] mb-1">AUC</div>
            <div className="text-[10px] font-mono text-[var(--text-2)]">
              EER <span style={{ color: qualEer(m.overall.eer) }}>{pct(m.overall.eer)}</span>
            </div>
          </div>
        ))}
        {/* Placeholder for future matchers */}
        {matchMatchers.length < 5 && Array.from({ length: 5 - matchMatchers.length }).map((_, i) => (
          <div key={"ph"+i} className="p-4 rounded-xl border border-dashed border-[var(--border-c)] bg-[var(--surface)] opacity-40">
            <div className="text-[10px] text-[var(--text-3)] uppercase tracking-wider mb-2">— future</div>
            <div className="text-2xl font-bold font-mono text-[var(--text-3)]">—</div>
          </div>
        ))}
      </div>

      {/* Horizontal tab bar */}
      <div className="border-b border-[var(--border-c)] mb-6 overflow-x-auto">
        <div className="flex gap-0 min-w-max">
          {TABS.map((t, i) => (
            <button
              key={t}
              onClick={() => setTab(i)}
              className="px-4 py-3 text-sm transition-colors border-b-2 whitespace-nowrap"
              style={{
                borderBottomColor: i === tab ? "var(--accent-c)" : "transparent",
                color: i === tab ? "var(--accent-c)" : "var(--text-2)",
                fontWeight: i === tab ? 600 : 400,
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {tab === 0 && <TabOverview data={data} />}
      {tab === 1 && <TabMatching data={data} />}
      {tab === 2 && <TabBias data={data} />}
      {tab === 3 && <TabCalibration data={data} />}
      {tab === 4 && <TabCost data={data} />}
      {tab === 5 && <TabDisagreement data={data} />}
    </div>
  );
}
