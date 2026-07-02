"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function HardCopyOverviewClient({ overview }: { overview: string }) {
  return (
    <div className="px-6 py-10 lg:px-12 lg:py-12 max-w-5xl">
      <div className="mb-6">
        <div
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-mono mb-4"
          style={{ background: "var(--primary-wash)", color: "var(--accent-c)", border: "1px solid var(--accent-c)" }}
        >
          IDV · Document Verification · Eval Harness
        </div>
      </div>
      <div className="prose">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{overview}</ReactMarkdown>
      </div>
    </div>
  );
}
