"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ContactDetail, ContactProfile } from "@/lib/crm";
import { downloadCsv } from "@/lib/csv";
import { LEAD_REPORT_ATTR } from "@/lib/lead-report-map";
import { getLeadStatusLabel, normalizeLeadStatus } from "@/lib/lead-status";
import { portalContactRoute } from "@/lib/portal-nav";
import LeadReportOverview, {
  type LeadSectionKey,
} from "@/app/components/portal/crm/LeadReportOverview";
import PortalToast from "@/app/components/portal/PortalToast";

type PortalContactLeadReportViewProps = {
  contactId: string;
  from?: string;
};

type SectionKey = LeadSectionKey;

type LeadReportToast = {
  key: number;
  message: string;
  variant: "success" | "info";
  persistent?: boolean;
  durationMs?: number;
};

function emptyProfile(): ContactProfile {
  return {
    qualification: {},
    company: {},
    meeting: {},
    brief: {},
    notes: [],
    timeline: [],
  };
}

function cloneProfile(profile?: ContactProfile | null): ContactProfile {
  const base = profile || {};
  return {
    ...emptyProfile(),
    ...base,
    qualification: { ...(base.qualification || {}) },
    company: { ...(base.company || {}) },
    meeting: { ...(base.meeting || {}) },
    brief: { ...(base.brief || {}) },
    notes: [...(base.notes || [])],
    timeline: [...(base.timeline || [])],
    apollo: base.apollo ? { ...base.apollo } : undefined,
  };
}

function applyContact(
  data: ContactDetail,
  setContact: (value: ContactDetail) => void,
  setDraftProfile: (value: ContactProfile) => void,
  setDraftCore: (value: {
    firstName: string;
    lastName: string;
    email: string;
    companyName: string;
    attributes: Record<string, string>;
  }) => void,
) {
  setContact(data);
  setDraftProfile(cloneProfile(data.profile));
  setDraftCore({
    firstName: data.firstName || "",
    lastName: data.lastName || "",
    email: data.email || "",
    companyName: data.companyName || "",
    attributes: { ...(data.attributes || {}) },
  });
}

export default function PortalContactLeadReportView({
  contactId,
  from,
}: PortalContactLeadReportViewProps) {
  const router = useRouter();
  const contactHref = portalContactRoute(contactId, from);
  const enrichAttemptedFor = useRef<string | null>(null);
  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<LeadReportToast | null>(null);
  const [editing, setEditing] = useState<SectionKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [draftProfile, setDraftProfile] = useState<ContactProfile>(emptyProfile());
  const [draftCore, setDraftCore] = useState({
    firstName: "",
    lastName: "",
    email: "",
    companyName: "",
    attributes: {} as Record<string, string>,
  });

  function showToast(next: Omit<LeadReportToast, "key"> | null) {
    if (!next) {
      setToast(null);
      return;
    }
    setToast({ ...next, key: Date.now() });
  }

  useEffect(() => {
    setEditing(null);
    setToast(null);
    setShareCopied(false);
    setShareUrl("");
    enrichAttemptedFor.current = null;
  }, [contactId]);

  async function createPublicUrl() {
    if (!contactId || shareBusy) return;
    setShareBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/crm/contacts/${contactId}/share`, {
        method: "POST",
      });
      const data = (await response.json()) as {
        url?: string;
        error?: string;
      };
      if (!response.ok || !data.url) {
        throw new Error(data.error || "Failed to create public URL");
      }
      setShareUrl(data.url);
      try {
        await navigator.clipboard.writeText(data.url);
        setShareCopied(true);
        window.setTimeout(() => setShareCopied(false), 2400);
      } catch {
        /* banner still shows the URL for manual copy */
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create public URL",
      );
    } finally {
      setShareBusy(false);
    }
  }

  function exportContactCsv() {
    if (!contact) return;
    const position =
      contact.profile?.title ||
      contact.attributes?.position ||
      contact.attributes?.title ||
      "";
    const solutions = String(
      contact.attributes?.[LEAD_REPORT_ATTR.solutions] || "",
    );
    const stage = contact.profile?.leadStage
      ? getLeadStatusLabel(normalizeLeadStatus(contact.profile.leadStage))
      : "";
    const filename = `lead-report-${(contact.email || contact.id || "contact")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .slice(0, 64)}.csv`;
    const noteText = (contact.profile?.notes || [])
      .map((note) => String(note.body || "").trim())
      .filter(Boolean)
      .join(" | ");
    downloadCsv(
      filename,
      [
        "First name",
        "Last name",
        "Email",
        "Company",
        "Position",
        "Stage",
        "Solution",
        "Project",
        "Owner",
        "Phone",
        "LinkedIn",
        "Company description",
        "Notes",
      ],
      [
        [
          contact.firstName || "",
          contact.lastName || "",
          contact.email || "",
          contact.companyName || "",
          position,
          stage,
          solutions,
          contact.attributes?.[LEAD_REPORT_ATTR.project] || "",
          contact.attributes?.[LEAD_REPORT_ATTR.owner] || "",
          contact.profile?.phone || contact.attributes?.phone || "",
          contact.profile?.linkedinUrl ||
            contact.attributes?.personalLinkedIn ||
            "",
          contact.profile?.company?.description || "",
          noteText,
        ],
      ],
    );
  }

  useEffect(() => {
    let cancelled = false;

    async function loadAndEnrich() {
      if (!contactId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/crm/contacts/${contactId}`);
        const data = (await response.json()) as ContactDetail & { error?: string };
        if (!response.ok) {
          throw new Error(data.error || "Failed to load contact");
        }
        if (cancelled) {
          return;
        }
        applyContact(data, setContact, setDraftProfile, setDraftCore);
        setLoading(false);

        const alreadyEnriched = Boolean(data.profile?.apollo?.enrichedAt);
        if (alreadyEnriched || enrichAttemptedFor.current === contactId) {
          return;
        }
        enrichAttemptedFor.current = contactId;
        showToast({
          message: "Searching the web for contact details…",
          variant: "info",
          persistent: true,
        });
        try {
          const enrichResponse = await fetch(
            `/api/crm/contacts/${contactId}/apollo-enrich`,
            { method: "POST" },
          );
          const enrichData = (await enrichResponse.json()) as ContactDetail & {
            error?: string;
          };
          if (cancelled) {
            return;
          }
          if (enrichResponse.ok) {
            applyContact(enrichData, setContact, setDraftProfile, setDraftCore);
            showToast({
              message: "Contact details updated from public sources",
              variant: "success",
              durationMs: 3200,
            });
          } else if (enrichResponse.status === 409) {
            showToast(null);
          } else {
            showToast(null);
            setError(
              enrichData.error ||
                "We could not find additional contact details online.",
            );
          }
        } catch (err) {
          if (!cancelled) {
            showToast(null);
            setError(
              err instanceof Error
                ? err.message
                : "We could not find additional contact details online.",
            );
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load contact");
          setLoading(false);
        }
      }
    }

    void loadAndEnrich();
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  const navigation = contact?.navigation;

  function beginEdit(section: SectionKey) {
    if (!contact) return;
    setDraftProfile(cloneProfile(contact.profile));
    setDraftCore({
      firstName: contact.firstName || "",
      lastName: contact.lastName || "",
      email: contact.email || "",
      companyName: contact.companyName || "",
      attributes: { ...(contact.attributes || {}) },
    });
    setEditing(section);
    setError("");
    showToast(null);
  }

  function cancelEdit() {
    if (!contact) return;
    setDraftProfile(cloneProfile(contact.profile));
    setDraftCore({
      firstName: contact.firstName || "",
      lastName: contact.lastName || "",
      email: contact.email || "",
      companyName: contact.companyName || "",
      attributes: { ...(contact.attributes || {}) },
    });
    setEditing(null);
  }

  async function saveSection() {
    if (!contact || !editing) return;
    setSaving(true);
    setError("");
    showToast(null);
    try {
      const body =
        editing === "information" ||
        editing === "identity" ||
        editing === "contactDetails"
          ? {
              firstName: draftCore.firstName,
              lastName: draftCore.lastName,
              email: draftCore.email,
              companyName: draftCore.companyName,
              attributes: draftCore.attributes,
              profile: draftProfile,
            }
          : { profile: draftProfile };

      const response = await fetch(`/api/crm/contacts/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as ContactDetail & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Failed to save");
      }
      applyContact(data, setContact, setDraftProfile, setDraftCore);
      setEditing(null);
      showToast({
        message: "Changes saved",
        variant: "success",
        durationMs: 2800,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function patchProfile(updater: (current: ContactProfile) => ContactProfile) {
    setDraftProfile((current) => updater(cloneProfile(current)));
  }

  if (loading) {
    return (
      <>
        <div className="lead-report-toolbar">
          <button
            type="button"
            className="btn-soft lead-report-back"
            onClick={() => router.push(contactHref)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Back
          </button>
        </div>
        <div className="lr-loader lr-loader-page" role="status" aria-live="polite">
          <span className="lr-loader-spinner" aria-hidden="true" />
          <span>Loading lead report…</span>
        </div>
      </>
    );
  }

  if (error && !contact) {
    return (
      <>
        <div className="lead-report-toolbar">
          <button
            type="button"
            className="btn-soft lead-report-back"
            onClick={() => router.push(contactHref)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Back
          </button>
        </div>
        <div className="crm-error">{error}</div>
      </>
    );
  }

  if (!contact) {
    return <div className="crm-error">Contact not found.</div>;
  }

  return (
    <>
      <div className="lead-report-toolbar">
        <button
          type="button"
          className="btn-soft lead-report-back"
          onClick={() => router.push(contactHref)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back
        </button>
        <div className="lead-report-toolbar-right">
          <div className="cd-pager lead-report-pager">
            <button
              type="button"
              aria-label="Previous contact"
              disabled={!navigation?.prevId}
              onClick={() =>
                navigation?.prevId
                  ? router.push(
                      portalContactRoute(navigation.prevId, from, {
                        view: "lead-report",
                      }),
                    )
                  : undefined
              }
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <span>
              {navigation && navigation.total > 0
                ? `${navigation.index + 1} of ${navigation.total}`
                : "0 of 0"}
            </span>
            <button
              type="button"
              aria-label="Next contact"
              disabled={!navigation?.nextId}
              onClick={() =>
                navigation?.nextId
                  ? router.push(
                      portalContactRoute(navigation.nextId, from, {
                        view: "lead-report",
                      }),
                    )
                  : undefined
              }
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>
          <button
            type="button"
            className="btn-soft lead-share-btn"
            disabled={!contact}
            onClick={() => exportContactCsv()}
          >
            Export CSV
          </button>
          <button
            type="button"
            className="btn-soft lead-share-btn"
            disabled={shareBusy}
            onClick={() => void createPublicUrl()}
          >
            {shareCopied
              ? "Public URL copied"
              : shareBusy
                ? "Creating…"
                : "Create public URL"}
          </button>
        </div>
      </div>

      {error ? <p className="crm-error">{error}</p> : null}
      {toast ? (
        <PortalToast
          key={toast.key}
          message={toast.message}
          variant={toast.variant}
          durationMs={toast.durationMs}
          persistent={toast.persistent}
          onDone={() => setToast(null)}
        />
      ) : null}
      {shareUrl ? (
        <div className="an-share-banner">
          <span>Share this lead report with a client:</span>
          <input
            readOnly
            value={shareUrl}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      ) : null}

      <LeadReportOverview
        contact={contact}
        editing={editing}
        saving={saving}
        draftProfile={draftProfile}
        draftCore={draftCore}
        setDraftCore={setDraftCore}
        patchProfile={patchProfile}
        beginEdit={beginEdit}
        cancelEdit={cancelEdit}
        saveSection={() => void saveSection()}
        historyEvents={contact.history}
        campaignStats={contact.campaignStats}
      />
    </>
  );
}
