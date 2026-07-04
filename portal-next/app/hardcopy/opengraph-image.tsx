import { ImageResponse } from "next/og";

export const dynamic = "force-static";
export const alt = "Hard Copy — Document IDV Eval Harness";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#16080d",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "72px 80px",
          fontFamily: "system-ui, -apple-system, sans-serif",
          position: "relative",
        }}
      >
        {/* Top accent bar */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 6,
            background: "linear-gradient(90deg, #C24A66 0%, #E07090 50%, #F4A8BB 100%)",
            display: "flex",
          }}
        />

        {/* Brand tag */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginBottom: 28,
            gap: 10,
          }}
        >
          <div
            style={{
              fontSize: 13,
              color: "#C24A66",
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Document IDV · Eval Harness
          </div>
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: 84,
            fontWeight: 700,
            color: "#f8edf0",
            lineHeight: 1.0,
            marginBottom: 24,
            letterSpacing: "-0.02em",
          }}
        >
          Hard Copy
        </div>

        {/* Description */}
        <div
          style={{
            fontSize: 22,
            color: "#b89aa4",
            lineHeight: 1.55,
            maxWidth: 780,
            marginBottom: 52,
          }}
        >
          Can a vision model classify, read, and authenticate identity documents
          as well as specialist pipelines? Measured end-to-end against real baselines.
        </div>

        {/* Stats */}
        <div style={{ display: "flex", gap: 56 }}>
          {[
            { value: "98.3%", label: "Field extraction accuracy" },
            { value: "1.000", label: "Auth AUC on SIDTD forgeries" },
            { value: "~3%", label: "Face match EER (doc→selfie)" },
          ].map((s) => (
            <div
              key={s.label}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div
                style={{
                  fontSize: 38,
                  fontWeight: 700,
                  color: "#f0dde3",
                  lineHeight: 1,
                }}
              >
                {s.value}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "#6b3d4a",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                }}
              >
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {/* Footer domain */}
        <div
          style={{
            position: "absolute",
            bottom: 36,
            right: 80,
            fontSize: 14,
            color: "#4a2030",
            fontWeight: 500,
            letterSpacing: "0.05em",
          }}
        >
          bio-idv.letsinvent.co.uk
        </div>
      </div>
    ),
    { ...size }
  );
}
