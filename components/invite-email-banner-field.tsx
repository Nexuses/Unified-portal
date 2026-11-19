"use client";

import { canPreviewImage } from "@/lib/image-field";
import { isEmailBannerUsable, resolveComposerEmailBanner } from "@/lib/email-banner";

type EmailBannerEditorProps = {
  useEventBanner: boolean;
  onUseEventBannerChange: (enabled: boolean) => void;
  eventBanner: string;
  variant?: "invite" | "email-flow";
};

function ToggleSwitch({
  enabled,
  disabled,
  onClick,
}: {
  enabled: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition disabled:cursor-not-allowed disabled:opacity-40 ${
        enabled ? "bg-emerald-600" : "bg-black/20"
      }`}
    >
      <span
        className={`h-5 w-5 rounded-full bg-white transition ${
          enabled ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export function EmailBannerEditor({
  useEventBanner,
  onUseEventBannerChange,
  eventBanner,
  variant = "invite",
}: EmailBannerEditorProps) {
  const hasEventBanner = isEmailBannerUsable(eventBanner);
  const resolvedPreview = resolveComposerEmailBanner({
    eventBanner,
    useEventBanner,
  });
  const showPreview = resolvedPreview && canPreviewImage(resolvedPreview);
  const isEmailFlow = variant === "email-flow";
  const shellClass = isEmailFlow
    ? "mt-5 rounded-2xl border border-emerald-200/90 bg-emerald-50/40 p-4"
    : "mt-4 rounded-xl border border-black/10 bg-white p-4";

  return (
    <div className={shellClass}>
      <p
        className={`text-sm font-medium ${isEmailFlow ? "font-semibold text-emerald-950" : "text-black"}`}
      >
        Banner in email
      </p>
      <p className={`mt-1 text-xs ${isEmailFlow ? "text-emerald-900/70" : "text-black/50"}`}>
        Include the event banner image in invite and reminder emails.
      </p>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-black/8 bg-white/80 px-3 py-2.5">
        <div>
          <p className="text-xs font-medium text-black">Use event banner</p>
          <p className="mt-0.5 text-[11px] text-black/45">
            {hasEventBanner
              ? "Fetches the banner from this event."
              : "No event banner yet — add one in Edit Event."}
          </p>
        </div>
        <ToggleSwitch
          enabled={useEventBanner && hasEventBanner}
          disabled={!hasEventBanner}
          onClick={() => onUseEventBannerChange(!useEventBanner)}
        />
      </div>

      {showPreview ? (
        <div className="mt-3 inline-flex max-w-[220px] flex-col overflow-hidden rounded-lg border border-black/10 bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element -- banner preview */}
          <img
            src={resolvedPreview}
            alt="Email banner preview"
            className="block h-16 w-full max-w-[220px] object-cover object-center"
          />
          <p className="border-t border-black/8 px-2.5 py-1.5 text-[10px] text-black/45">
            Preview: event banner
          </p>
        </div>
      ) : null}
    </div>
  );
}

export const InviteEmailBannerField = EmailBannerEditor;
export const EmailFlowBannerToggle = EmailBannerEditor;
