"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function HardCopyAtlasClient({ atlas }: { atlas: string }) {
  return (
    <div className="px-6 py-10 lg:px-12 lg:py-12 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-1" style={{ fontFamily: "var(--font-display)" }}>
          Atlas — Identity Document Verification
        </h1>
        <p className="text-[var(--text-2)] text-sm">
          Domain and tech glossary for IDV: document types, authenticity, extraction, face-on-document match,
          and the governance layer. Companion to the biometric Atlas in Face Value.
        </p>
      </div>
      <div className="prose">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{atlas}</ReactMarkdown>
      </div>
    </div>
  );
}
