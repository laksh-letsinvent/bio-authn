"use client";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

const TABS = [
  { id: "atlas", label: "Glossary" },
  { id: "standards", label: "Standards" },
  { id: "compliance", label: "Compliance" },
];

export function AtlasClient({
  atlas,
  standards,
  compliance,
}: {
  atlas: string;
  standards: string;
  compliance: string;
}) {
  const [tab, setTab] = useState("atlas");

  const content = tab === "atlas" ? atlas : tab === "standards" ? standards : compliance;

  return (
    <div className="px-6 py-10 lg:px-12 lg:py-12 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-1" style={{ fontFamily: "var(--font-display)" }}>
          Atlas
        </h1>
        <p className="text-[var(--text-2)] text-sm">
          Domain glossary, standards references, and compliance notes (~130 terms).
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 p-1 rounded-lg bg-[var(--surface-2)] w-fit">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === t.id
                ? "bg-[var(--surface)] text-[var(--foreground)] shadow-sm"
                : "text-[var(--text-2)] hover:text-[var(--foreground)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="prose">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
