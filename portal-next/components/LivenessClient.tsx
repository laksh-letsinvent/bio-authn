"use client";
import { useState, useEffect } from "react";

type PadExample = {
  subject: string;
  genuine: string;
  print_attack: string;
  screen_attack: string;
};

function imgPath(p: string) { return "/" + p; }

const ATTACK_TYPES = [
  {
    id: "genuine",
    label: "Genuine",
    color: "var(--accept)",
    zone: "var(--accept-zone)",
    desc: "A live face in front of the camera. Active-liveness challenge satisfied — blink + head turn. EAR dips on blink; head yaw registers motion.",
    verdict: "LIVE",
    verdictColor: "var(--accept)",
  },
  {
    id: "print_attack",
    label: "Print attack",
    color: "var(--reject)",
    zone: "var(--reject-zone)",
    desc: "A printed photograph held up to the camera. No blink, no head motion. EAR stays flat. Yaw static. Active-liveness challenge fails immediately.",
    verdict: "SPOOF",
    verdictColor: "var(--reject)",
  },
  {
    id: "screen_attack",
    label: "Screen replay",
    color: "var(--uncertain)",
    zone: "var(--uncertain-zone)",
    desc: "A photo or video played back on a screen. May fool a texture-only check. Active-liveness + depth cues catch it. Screen moiré visible at close range.",
    verdict: "SPOOF",
    verdictColor: "var(--reject)",
  },
];

function EarMeter({ value }: { value: number }) {
  const color = value < 0.2 ? "var(--reject)" : value < 0.3 ? "var(--uncertain)" : "var(--accept)";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-[var(--text-3)] uppercase tracking-wider">Eye Aspect Ratio</div>
        <div className="text-xs font-mono" style={{ color }}>{value.toFixed(3)} {value < 0.2 ? "← blink" : "← open"}</div>
      </div>
      <div className="h-2.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
        <div className="h-full rounded-full transition-all duration-200" style={{ width: `${Math.min(value / 0.5, 1) * 100}%`, background: color }} />
      </div>
    </div>
  );
}

function YawNeedle({ angle }: { angle: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-[var(--text-3)] uppercase tracking-wider">Head yaw</div>
        <div className="text-xs font-mono text-[var(--text-2)]">{angle > 0 ? "→ " : angle < 0 ? "← " : "· "}{Math.abs(angle)}°</div>
      </div>
      <div className="relative h-3 bg-[var(--surface-2)] rounded-full overflow-hidden">
        <div
          className="absolute top-0.5 bottom-0.5 w-1 rounded bg-[var(--accent-c)] transition-all duration-300"
          style={{ left: `calc(${50 + (angle / 45) * 40}% - 2px)` }}
        />
        <div className="absolute inset-0 flex items-center justify-between px-2 text-[8px] text-[var(--text-3)] pointer-events-none">
          <span>L</span><span>·</span><span>R</span>
        </div>
      </div>
    </div>
  );
}

export function LivenessClient() {
  const [examples, setExamples] = useState<PadExample[]>([]);
  const [selectedSubject, setSelectedSubject] = useState(0);
  const [selectedType, setSelectedType] = useState(0);
  const [ear, setEar] = useState(0.35);
  const [yaw, setYaw] = useState(0);
  const [blinkDone, setBlinkDone] = useState(false);
  const [turnDone, setTurnDone] = useState(false);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    fetch("/data/pad_examples.json").then((r) => r.json()).then(setExamples);
  }, []);

  useEffect(() => {
    if (selectedType !== 0) { setEar(0.34); setYaw(0); setAnimating(false); return; }
    let t: ReturnType<typeof setTimeout>;
    const run = () => {
      setAnimating(true);
      setTimeout(() => setEar(0.07), 300);
      setTimeout(() => { setEar(0.35); setBlinkDone(true); }, 650);
      setTimeout(() => setYaw(20), 1000);
      setTimeout(() => setYaw(0), 1450);
      setTimeout(() => setYaw(-16), 1800);
      setTimeout(() => { setYaw(0); setTurnDone(true); setAnimating(false); }, 2200);
      t = setTimeout(run, 4500);
    };
    t = setTimeout(run, 600);
    return () => clearTimeout(t);
  }, [selectedType]);

  const attackType = ATTACK_TYPES[selectedType];
  const ex = examples[selectedSubject];
  const imgKey = attackType.id as keyof PadExample;

  return (
    <div className="px-6 py-10 lg:px-12 lg:py-12 max-w-5xl">
      <div className="mb-8">
        <div className="text-[11px] text-[var(--accent-c)] font-mono uppercase tracking-widest mb-2">PAD In Action</div>
        <h1 className="text-4xl font-bold mb-3" style={{ fontFamily: "var(--font-display)" }}>
          Presentation Attack Detection
        </h1>
        <p className="text-[var(--text-2)] text-base max-w-2xl">
          The attacks go after the sensor, not the matcher. Telling a live face from a photo of one is a different problem from telling two faces apart.
        </p>
      </div>

      {/* Honest limits */}
      <div className="p-4 rounded-xl border border-[var(--uncertain)] bg-[var(--uncertain-zone)] text-sm mb-8">
        <strong className="text-[var(--uncertain)]">Honest limit:</strong>
        <span className="text-[var(--text-2)] ml-1">
          Active-liveness (EAR + yaw challenge) stops a static photo. It does not stop a high-quality deepfake video.
          Stopping video injection requires signed-capture integrity at the sensor. These are separate problems.
        </span>
      </div>

      {/* Spot-the-attack panel */}
      <section className="mb-8 p-5 rounded-xl border border-[var(--border-c)] bg-[var(--surface)]">
        <h2 className="text-lg font-semibold mb-4" style={{ fontFamily: "var(--font-display)" }}>Spot the attack</h2>

        {/* Subject selector */}
        {examples.length > 0 && (
          <div className="flex gap-2 mb-4">
            {examples.map((e, i) => (
              <button
                key={e.subject}
                onClick={() => setSelectedSubject(i)}
                className="px-3 py-1.5 text-xs rounded-lg transition-colors border"
                style={{
                  background: i === selectedSubject ? "var(--primary-wash)" : "var(--surface-2)",
                  borderColor: i === selectedSubject ? "var(--accent-c)" : "var(--border-c)",
                  color: i === selectedSubject ? "var(--accent-c)" : "var(--text-2)",
                }}
              >
                {e.subject.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        )}

        {/* Attack type selector */}
        <div className="flex flex-wrap gap-2 mb-6">
          {ATTACK_TYPES.map((t, i) => (
            <button
              key={t.id}
              onClick={() => setSelectedType(i)}
              className="px-4 py-2 text-sm rounded-lg transition-colors border font-medium"
              style={{
                background: i === selectedType ? t.zone : "var(--surface-2)",
                borderColor: i === selectedType ? t.color : "var(--border-c)",
                color: i === selectedType ? t.color : "var(--text-2)",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-8 items-start">
          {/* Image — bigger */}
          <div className="shrink-0">
            {ex ? (
              <div
                className="rounded-xl overflow-hidden border-2 bg-[var(--surface-2)]"
                style={{
                  width: 220, height: 220,
                  borderColor: selectedType === 0 ? "var(--accept)" : "var(--reject)",
                }}
              >
                <img
                  src={imgPath(ex[imgKey])}
                  alt={`${ex.subject} ${attackType.label}`}
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.2"; }}
                />
              </div>
            ) : (
              <div className="w-56 h-56 rounded-xl bg-[var(--surface-2)] border border-[var(--border-c)] flex items-center justify-center text-[var(--text-3)] text-xs">
                loading…
              </div>
            )}
            <div className="mt-2 text-center text-[11px] text-[var(--text-3)]">{attackType.label}</div>
          </div>

          {/* Meters */}
          <div className="flex-1 min-w-[220px] flex flex-col gap-5">
            {/* Verdict */}
            <div
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full font-bold text-sm self-start"
              style={{ background: attackType.zone, color: attackType.verdictColor, border: `1.5px solid ${attackType.verdictColor}` }}
            >
              <span className={selectedType === 0 && animating ? "animate-pulse" : ""}>{attackType.verdict === "LIVE" ? "●" : "✗"}</span>
              {attackType.verdict} SIGNAL
            </div>

            <EarMeter value={selectedType === 0 ? ear : 0.34} />
            <YawNeedle angle={selectedType === 0 ? yaw : 0} />

            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] text-[var(--text-3)] uppercase tracking-wider mb-0.5">Active challenge</div>
              {[
                { label: "Blink detected", done: selectedType === 0 && blinkDone },
                { label: "Head turn registered", done: selectedType === 0 && turnDone },
                { label: "Motion continuous", done: selectedType === 0 && animating },
              ].map((ch) => (
                <div key={ch.label} className="flex items-center gap-2 text-sm">
                  <span style={{ color: ch.done ? "var(--accept)" : "var(--text-3)" }}>{ch.done ? "✓" : "○"}</span>
                  <span style={{ color: ch.done ? "var(--foreground)" : "var(--text-3)" }}>{ch.label}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-[var(--text-2)] leading-relaxed">{attackType.desc}</p>
          </div>
        </div>
      </section>

      {/* APCER/BPCER */}
      <section className="mb-8 p-5 rounded-xl border border-[var(--border-c)] bg-[var(--surface)]">
        <h2 className="text-base font-semibold mb-4" style={{ fontFamily: "var(--font-display)" }}>APCER / BPCER — liveness metrics</h2>
        <div className="p-3 rounded-lg border border-[var(--uncertain)] bg-[var(--uncertain-zone)] text-[var(--uncertain)] text-xs mb-4">
          Eval findings on this corpus: PAD baseline AUC 0.47 — no usable signal on synthetic data.
          PAD VLM results cover obvious simulated attacks only — a floor, not a real-world number.
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          {[
            {
              name: "APCER", full: "Attack Presentation Classification Error Rate",
              desc: "Fraction of spoof attempts wrongly accepted as live. Analogous to FAR in matching but for the liveness layer. A photo that passes = APCER error.",
              color: "var(--reject)",
            },
            {
              name: "BPCER", full: "Bona Fide Presentation Classification Error Rate",
              desc: "Fraction of genuine live users wrongly rejected as spoofs. A real person failing the blink challenge = BPCER error. Analogous to FRR in matching.",
              color: "var(--uncertain)",
            },
          ].map((m) => (
            <div key={m.name} className="p-4 rounded-lg border border-[var(--border-c)] bg-[var(--surface-2)]">
              <div className="text-2xl font-bold font-mono mb-1" style={{ color: m.color }}>{m.name}</div>
              <div className="text-[10px] text-[var(--text-3)] mb-2 uppercase tracking-wider">{m.full}</div>
              <p className="text-sm text-[var(--text-2)] leading-relaxed">{m.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Attack taxonomy */}
      <section className="p-5 rounded-xl border border-[var(--border-c)] bg-[var(--surface)]">
        <h2 className="text-base font-semibold mb-4" style={{ fontFamily: "var(--font-display)" }}>Attack taxonomy</h2>
        <div className="flex flex-col gap-2">
          {[
            { name: "Print attack",      level: "L1", desc: "Static printed photo. Stopped by active-liveness (EAR + yaw challenge).",                           diff: "Easy",      dc: "var(--accept)" },
            { name: "Screen replay",     level: "L2", desc: "Video played on screen. Moiré artefacts visible. Stopped by texture analysis.",                       diff: "Moderate",   dc: "var(--uncertain)" },
            { name: "3D mask",           level: "L3", desc: "Silicone or rigid mask. Requires depth sensors or near-infrared to catch reliably.",                   diff: "Hard",       dc: "var(--reject)" },
            { name: "Deepfake injection",level: "L4", desc: "Synthetic video injected directly into the video stream. Requires signed-capture integrity at the sensor.", diff: "Very hard", dc: "var(--reject)" },
          ].map((a) => (
            <div key={a.name} className="flex items-start gap-4 p-4 rounded-lg bg-[var(--surface-2)] border border-[var(--border-c)]">
              <span className="font-mono text-xs text-[var(--text-3)] pt-0.5 w-5 shrink-0">{a.level}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-[var(--foreground)]">{a.name}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: a.dc + "20", color: a.dc }}>{a.diff}</span>
                </div>
                <p className="text-xs text-[var(--text-2)] leading-relaxed">{a.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
