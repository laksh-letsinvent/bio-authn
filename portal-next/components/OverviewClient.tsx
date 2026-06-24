"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

export function OverviewClient({ content }: { content: string }) {
  return (
    <div className="px-6 py-10 lg:px-12 lg:py-12 max-w-4xl">
      <div className="mb-8">
        <div className="text-[11px] text-[var(--accent-c)] font-mono uppercase tracking-widest mb-2">
          Face Value · v2
        </div>
        <h1 className="text-4xl font-bold mb-3" style={{ fontFamily: "var(--font-display)" }}>
          The Experiment
        </h1>
        <p className="text-[var(--text-2)] text-base leading-relaxed max-w-2xl">
          An eval-first harness for selfie biometric authentication — measuring accuracy, fairness, calibration, cost, and latency across face matchers.
        </p>
      </div>

      <div className="prose">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
