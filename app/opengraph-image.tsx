import { ImageResponse } from "next/og";

export const alt = "Nexuses Unified Portal";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          background: "linear-gradient(145deg, #f5fbf6 0%, #e8f8ec 45%, #d7fec8 100%)",
          color: "#111827",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background: "#D7FEC8",
              border: "2px solid #006b52",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#006b52",
              fontSize: 42,
              fontWeight: 800,
            }}
          >
            N
          </div>
          <div
            style={{
              fontSize: 36,
              fontWeight: 700,
              color: "#006b52",
            }}
          >
            Nexuses
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              fontSize: 72,
              fontWeight: 800,
              letterSpacing: "-0.04em",
              lineHeight: 1.05,
              maxWidth: 900,
            }}
          >
            Unified Portal
          </div>
          <div
            style={{
              fontSize: 30,
              color: "#4b5563",
              maxWidth: 820,
              lineHeight: 1.35,
            }}
          >
            Campaigns, CRM, automations, and analytics in one workspace.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
