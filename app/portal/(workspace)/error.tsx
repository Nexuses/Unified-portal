"use client";

import { useEffect } from "react";

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Portal workspace error:", error);
  }, [error]);

  return (
    <div className="crm-empty" style={{ margin: "24px 0", maxWidth: 520 }}>
      <h3 style={{ margin: "0 0 8px" }}>This page couldn’t load</h3>
      <p className="desc" style={{ marginBottom: 16 }}>
        Something went wrong while rendering this view. Try again, or open
        another section from the sidebar.
      </p>
      <button type="button" className="btn-dark" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
