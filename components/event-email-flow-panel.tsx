"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  applyEmailFlowPlaceholders,
  buildEmailFlowPreviewHtml,
  getDefaultEmailFlowTemplate,
  getEmailFlowsForFormat,
  type EmailFlowKey,
  type EmailFlowTemplate,
  type EventEmailFlows,
} from "@/lib/event-email-flows";
import type { EventFormat } from "@/lib/event-format";
import { platformUsesMeetingLink } from "@/lib/event-platform";
import { formatEventEmailDateTime } from "@/lib/public-event-time";

type EventEmailFlowPanelProps = {
  open: boolean;
  onClose: () => void;
  eventFormat: EventFormat;
  eventName: string;
  eventDate: string;
  eventTimeStart: string;
  eventTimeEnd: string;
  platform: string;
  platformLink: string;
  emailFlows: EventEmailFlows;
  eventBanner?: string;
  emailIncludeEventBanner?: boolean;
  onChange: (flows: EventEmailFlows) => void;
};

function mergeFlow(
  flows: EventEmailFlows,
  flowKey: EmailFlowKey,
  eventName: string,
  patch: Partial<EmailFlowTemplate>
): EventEmailFlows {
  const current = flows[flowKey] ?? getDefaultEmailFlowTemplate(flowKey, eventName);
  return {
    ...flows,
    [flowKey]: { ...current, ...patch },
  };
}

export function EventEmailFlowPanel({
  open,
  onClose,
  eventFormat,
  eventName,
  eventDate,
  eventTimeStart,
  eventTimeEnd,
  platform,
  platformLink,
  emailFlows,
  eventBanner,
  emailIncludeEventBanner,
  onChange,
}: EventEmailFlowPanelProps) {
  const flowDefinitions = useMemo(
    () => getEmailFlowsForFormat(eventFormat),
    [eventFormat]
  );
  const [activeFlowId, setActiveFlowId] = useState<EmailFlowKey>(
    flowDefinitions[0]?.id ?? "registration"
  );
  const [previewMode, setPreviewMode] = useState<"rendered" | "source">("rendered");

  useEffect(() => {
    if (!flowDefinitions.some((flow) => flow.id === activeFlowId)) {
      setActiveFlowId(flowDefinitions[0]?.id ?? "registration");
    }
  }, [activeFlowId, flowDefinitions]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const activeDefinition =
    flowDefinitions.find((flow) => flow.id === activeFlowId) ?? flowDefinitions[0];
  if (!activeDefinition) return null;

  const activeTemplate =
    emailFlows[activeFlowId] ?? getDefaultEmailFlowTemplate(activeFlowId, eventName);

  const guestDateTime = formatEventEmailDateTime(eventDate, eventTimeStart, eventTimeEnd, null);
  const previewContext = {
    recipientName: "Alex",
    eventName: eventName.trim() || "Sample Event",
    eventDate: guestDateTime.displayDate,
    eventTime: guestDateTime.displayTime,
    platform: platform.trim() || "Zoom",
    platformLink: platformUsesMeetingLink(platform) ? platformLink.trim() : "",
  };

  const previewSubject = applyEmailFlowPlaceholders(activeTemplate.subject, previewContext);
  const previewHtml = buildEmailFlowPreviewHtml(activeFlowId, activeTemplate, previewContext, {
    includesGoingButton: activeDefinition.includesGoingButton,
    brandName: eventName.trim() || "Event",
    eventDateYmd: eventDate,
    bannerUrl: emailIncludeEventBanner ? eventBanner : "",
  });
  const fullEmailHtmlDocument = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${previewSubject.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</title>
</head>
<body>
${previewHtml}
</body>
</html>`;

  return createPortal(
    <div className="event-flow-backdrop" onClick={onClose}>
      <div
        className="event-flow-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-flow-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="event-flow-head">
          <div>
            <h3 id="event-flow-title">Email flow</h3>
            <p>
              Choose a message on the left, edit it here, and check the preview. Greeting, event
              details, and the accept button are added automatically.
            </p>
          </div>
          <button type="button" className="event-flow-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="event-flow-body">
          <nav className="event-flow-nav" aria-label="Email messages">
            {flowDefinitions.map((flow) => (
              <button
                key={flow.id}
                type="button"
                className={flow.id === activeFlowId ? "is-on" : undefined}
                onClick={() => setActiveFlowId(flow.id)}
              >
                <strong>{flow.label}</strong>
                <span>{flow.description}</span>
              </button>
            ))}
          </nav>

          <div className="event-flow-main">
            <section className="event-flow-card">
              <p className="event-flow-kicker">{activeDefinition.label}</p>
              <p className="event-flow-note">{activeDefinition.description}</p>
              <div className="event-flow-grid">
                <label className="event-flow-field">
                  Subject
                  <input
                    type="text"
                    value={activeTemplate.subject}
                    placeholder="Email subject"
                    onChange={(event) =>
                      onChange(mergeFlow(emailFlows, activeFlowId, eventName, { subject: event.target.value }))
                    }
                  />
                </label>
                <label className="event-flow-field">
                  Short line under the greeting
                  <textarea
                    value={activeTemplate.actionText}
                    placeholder="A short line for this email"
                    onChange={(event) =>
                      onChange(
                        mergeFlow(emailFlows, activeFlowId, eventName, { actionText: event.target.value })
                      )
                    }
                  />
                </label>
              </div>
              <p className="event-flow-note" style={{ marginTop: 10 }}>
                You can use {"{{eventName}}"}, {"{{eventDate}}"}, {"{{eventTime}}"}, and {"{{platform}}"}.
              </p>
            </section>

            <section className="event-flow-card">
              <div className="event-flow-split">
                <div>
                  <div className="event-flow-pane-head">
                    <span>Message</span>
                  </div>
                  <label className="event-flow-field">
                    <textarea
                      className="event-flow-html"
                      value={activeTemplate.messageHtml}
                      placeholder="Write the message"
                      spellCheck={false}
                      onChange={(event) =>
                        onChange(
                          mergeFlow(emailFlows, activeFlowId, eventName, { messageHtml: event.target.value })
                        )
                      }
                    />
                  </label>
                  <p className="event-flow-note" style={{ marginTop: 8 }}>
                    This is the body after the greeting. Headings, paragraphs, links, and lists are kept.
                  </p>
                </div>
                <div>
                  <div className="event-flow-pane-head">
                    <span>Preview</span>
                    <div className="event-flow-switch">
                      <button
                        type="button"
                        className={previewMode === "rendered" ? "is-on" : undefined}
                        onClick={() => setPreviewMode("rendered")}
                      >
                        Email
                      </button>
                      <button
                        type="button"
                        className={previewMode === "source" ? "is-on" : undefined}
                        onClick={() => setPreviewMode("source")}
                      >
                        HTML
                      </button>
                    </div>
                  </div>
                  <p className="event-flow-preview-subject">
                    Subject <strong>{previewSubject || "Email subject"}</strong>
                  </p>
                  {previewMode === "rendered" ? (
                    <div className="event-flow-preview">
                      <div
                        className="event-flow-preview-sheet"
                        dangerouslySetInnerHTML={{ __html: previewHtml }}
                      />
                    </div>
                  ) : (
                    <textarea className="event-flow-source" readOnly value={fullEmailHtmlDocument} spellCheck={false} />
                  )}
                  {activeDefinition.includesGoingButton ? (
                    <p className="event-flow-lock">The accept button is added in the sent email.</p>
                  ) : null}
                </div>
              </div>
            </section>
          </div>
        </div>

        <div className="event-flow-foot">
          <button type="button" className="btn-dark" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}