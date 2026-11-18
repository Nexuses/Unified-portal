"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type InviteAcceptedThankYouModalProps = {
  eventName?: string;
};

export function InviteAcceptedThankYouModal({ eventName }: InviteAcceptedThankYouModalProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const isInviteAccepted = searchParams.get("going") === "1";
  const isAcceptError = searchParams.get("accept-error") === "1";
  const [visible, setVisible] = useState(isInviteAccepted);
  const [errorVisible, setErrorVisible] = useState(isAcceptError);

  useEffect(() => {
    if (!isInviteAccepted) {
      return;
    }

    setVisible(true);
    const timer = window.setTimeout(() => {
      dismissSuccess();
    }, 10000);

    return () => window.clearTimeout(timer);
  }, [isInviteAccepted, pathname, router]);

  useEffect(() => {
    if (!isAcceptError) {
      return;
    }

    setErrorVisible(true);
    const timer = window.setTimeout(() => {
      dismissError();
    }, 10000);

    return () => window.clearTimeout(timer);
  }, [isAcceptError, pathname, router]);

  function dismissSuccess() {
    setVisible(false);
    router.replace(pathname, { scroll: false });
  }

  function dismissError() {
    setErrorVisible(false);
    router.replace(pathname, { scroll: false });
  }

  if (errorVisible) {
    return (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
        onClick={dismissError}
        role="presentation"
      >
        <div
          className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="accept-error-title"
        >
          <h2 id="accept-error-title" className="text-xl font-semibold text-black">
            Could not confirm attendance
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-black/65">
            This invite link may be expired or already used. Please contact the event organizer.
          </p>
        </div>
      </div>
    );
  }

  if (!visible) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={dismissSuccess}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="accept-success-title"
      >
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            className="h-7 w-7"
            aria-hidden
          >
            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 id="accept-success-title" className="text-xl font-semibold text-black">
          Thank you for registering!
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-black/65">
          {eventName
            ? `You're confirmed for ${eventName}. We look forward to seeing you there.`
            : "You're on the guest list. We look forward to seeing you there."}
        </p>
        <p className="mt-4 text-xs text-black/45">This message will close in 10 seconds.</p>
      </div>
    </div>
  );
}
