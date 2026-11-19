"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ButtonLoadingContent } from "@/components/button-loader";

type PublishButtonProps = {
  publicId: string;
  eventId: string;
  initialStatus: "draft" | "published";
};

export function PublishButton({ publicId, eventId, initialStatus }: PublishButtonProps) {
  const router = useRouter();
  const [isCopying, setIsCopying] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [copiedDialogOpen, setCopiedDialogOpen] = useState(false);
  const [status, setStatus] = useState<"draft" | "published">(initialStatus);

  useEffect(() => {
    if (!copiedDialogOpen) {
      return;
    }

    const timeout = setTimeout(() => setCopiedDialogOpen(false), 3000);
    return () => clearTimeout(timeout);
  }, [copiedDialogOpen]);

  return (
    <>
      <button
        type="button"
        onClick={async () => {
          if (status === "draft") {
            setIsUpdatingStatus(true);
            try {
              const response = await fetch(`/api/events/${eventId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "publish" }),
              });

              if (response.ok) {
                setStatus("published");
                router.refresh();
              }
            } finally {
              setIsUpdatingStatus(false);
            }
          }

          setDialogOpen(true);
        }}
        disabled={isUpdatingStatus}
        className="btn-dark"
      >
        <ButtonLoadingContent loading={isUpdatingStatus} loadingText="Publishing...">
          Publish
        </ButtonLoadingContent>
      </button>

      {dialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-black">Public event URL</h3>
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                className="rounded-md border border-black/10 px-2 py-1 text-xs text-black/60 hover:bg-black/5"
              >
                Close
              </button>
            </div>
            <p className="mt-2 text-sm text-black/70">
              Share this public link with attendees.
            </p>
            <div className="mt-4 rounded-xl border border-black/10 bg-[#f7f7f5] px-3 py-2 text-sm text-black/80">
              {`${typeof window !== "undefined" ? window.location.origin : ""}/e/${publicId}`}
            </div>
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                disabled={isCopying}
                onClick={async () => {
                  setIsCopying(true);
                  try {
                    const publicUrl = `${window.location.origin}/e/${publicId}`;
                    await navigator.clipboard.writeText(publicUrl);
                    setCopiedDialogOpen(true);
                  } finally {
                    setIsCopying(false);
                  }
                }}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#171717] px-5 text-xs font-medium text-white hover:bg-black disabled:opacity-70"
              >
                <ButtonLoadingContent loading={isCopying} loadingText="Copying...">
                  Copy URL
                </ButtonLoadingContent>
              </button>

              <button
                type="button"
                disabled={isUpdatingStatus || status === "draft"}
                onClick={async () => {
                  setIsUpdatingStatus(true);
                  try {
                    const response = await fetch(`/api/events/${eventId}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "unpublish" }),
                    });

                    if (response.ok) {
                      setStatus("draft");
                      setDialogOpen(false);
                      router.refresh();
                    }
                  } finally {
                    setIsUpdatingStatus(false);
                  }
                }}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-black/20 px-5 text-xs font-medium text-black hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ButtonLoadingContent loading={isUpdatingStatus} loadingText="Updating...">
                  Unpublish
                </ButtonLoadingContent>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {copiedDialogOpen ? (
        <div className="pointer-events-none fixed top-4 left-1/2 z-[70] -translate-x-1/2">
          <div className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-lg">
            URL copied
          </div>
        </div>
      ) : null}
    </>
  );
}
