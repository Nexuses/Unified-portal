"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ButtonLoadingContent } from "@/components/button-loader";
import { isEmailBannerUsable } from "@/lib/email-banner";
import { inviteDateBadge } from "@/lib/invite-email-layout";
import { readApiJson } from "@/lib/read-api-json";

const GOING_BUTTON_DELAY_MS = 3_000;
const GOING_BUTTON_DELAY_SECONDS = GOING_BUTTON_DELAY_MS / 1000;

type ConfirmGoingClientProps = {
  publicId: string;
  eventName: string;
  sid: string;
  email: string;
  bannerUrl: string;
  eventDateYmd: string;
  displayDate: string;
  displayTime: string;
  platform: string;
};

function EventBannerImage({ src, alt }: { src: string; alt: string }) {
  const trimmed = src.trim();
  if (!trimmed) {
    return null;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- project S3 hosts are not fixed
    <img
      src={trimmed}
      alt={alt}
      width={280}
      height={280}
      className="aspect-square w-full rounded-2xl border border-black/10 object-cover object-center"
    />
  );
}

export function ConfirmGoingClient({
  publicId,
  eventName,
  sid,
  email,
  bannerUrl,
  eventDateYmd,
  displayDate,
  displayTime,
  platform,
}: ConfirmGoingClientProps) {
  const router = useRouter();
  const [secondsLeft, setSecondsLeft] = useState(GOING_BUTTON_DELAY_SECONDS);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const hasBanner = isEmailBannerUsable(bannerUrl);
  const badge = inviteDateBadge(eventDateYmd);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const remainingMs = GOING_BUTTON_DELAY_MS - elapsed;
      const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
      setSecondsLeft(remainingSeconds);
      if (remainingMs <= 0) {
        setReady(true);
        window.clearInterval(timer);
      }
    }, 200);

    return () => window.clearInterval(timer);
  }, []);

  async function confirmGoing() {
    if (!ready || loading) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const payload: { sid?: string; email?: string } = {};
      if (sid) {
        payload.sid = sid;
      } else if (email) {
        payload.email = email;
      }

      const response = await fetch(`/api/public-events/${publicId}/accept-invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await readApiJson<{ message?: string }>(response);
      if (!response.ok) {
        throw new Error(data.message || "Could not confirm attendance.");
      }

      router.push(`/e/${publicId}?going=1`);
    } catch (confirmError) {
      setError(
        confirmError instanceof Error ? confirmError.message : "Could not confirm attendance."
      );
      setLoading(false);
    }
  }

  return (
    <div className={`mx-auto w-full ${hasBanner ? "max-w-[920px]" : "max-w-[560px]"}`}>
      <div
        className={`flex flex-col gap-5 ${hasBanner ? "md:flex-row md:items-start" : ""}`}
      >
        {hasBanner ? (
          <div className="w-full shrink-0 md:w-[280px]">
            <EventBannerImage src={bannerUrl} alt={eventName} />
          </div>
        ) : null}

        <div className="min-w-0 flex-1 overflow-hidden rounded-[20px] border border-black/[0.06] bg-white">
          <div className="px-7 py-7 md:px-8 md:py-8">
            <p className="text-[15px] leading-snug text-[#9ca3af]">You&apos;re invited to</p>
            <h1 className="mt-2 text-[28px] font-bold leading-tight text-[#111827]">
              {eventName}
            </h1>
            <p className="mt-4 text-[15px] leading-relaxed text-[#4b5563]">
              Confirm that you are attending this event.
            </p>

            <div className="mt-6 flex items-start gap-3.5">
              <div className="flex h-[52px] w-[52px] shrink-0 flex-col items-center overflow-hidden rounded-xl border border-[#e5e7eb] bg-white text-center">
                <span className="pt-2 text-[10px] font-bold leading-none tracking-[0.06em] text-[#111111]">
                  {badge.month}
                </span>
                <span className="pt-0.5 text-lg font-bold leading-tight text-[#111827]">
                  {badge.day}
                </span>
              </div>
              <div className="min-w-0 pt-0.5">
                <p className="text-base font-bold leading-snug text-[#111827]">{displayDate}</p>
                <p className="mt-1 text-sm leading-snug text-[#6b7280]">{displayTime}</p>
              </div>
            </div>

            {platform ? (
              <div className="mt-4 flex items-center gap-3.5">
                <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl border border-[#e5e7eb] bg-white">
                  {/in\s*person/i.test(platform) ? (
                    <svg
                      width="26"
                      height="26"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#111111"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M12 21s7-5.3 7-11a7 7 0 10-14 0c0 5.7 7 11 7 11z" />
                      <circle cx="12" cy="10" r="2.5" />
                    </svg>
                  ) : (
                    <svg
                      width="26"
                      height="26"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#111111"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
                      <path d="M15.5 10.2l5.2-2.6c.5-.2 1 .1 1 .7v7.4c0 .6-.5.9-1 .7l-5.2-2.6" />
                    </svg>
                  )}
                </div>
                <p className="text-[15px] font-semibold leading-snug text-[#111827]">{platform}</p>
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => void confirmGoing()}
              disabled={!ready || loading}
              className="mt-7 inline-flex min-w-[168px] items-center justify-center gap-2 rounded-full bg-[#111111] px-[22px] py-3 text-[15px] font-bold text-white transition-opacity disabled:cursor-not-allowed disabled:bg-[#9ca3af] disabled:opacity-90"
            >
              <ButtonLoadingContent loading={loading} loadingText="Confirming...">
                Accept Invite
              </ButtonLoadingContent>
            </button>

            {!ready ? (
              <p className="mt-4 text-[13px] leading-relaxed text-[#9ca3af]">
                Button activates in {secondsLeft} second{secondsLeft === 1 ? "" : "s"}
              </p>
            ) : (
              <p className="mt-4 text-[13px] leading-relaxed text-[#9ca3af]">
                Tap Accept Invite to join the guest list.
              </p>
            )}

            {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
