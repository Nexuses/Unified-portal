"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ContactDetail, ContactProfile } from "@/lib/crm";
import { portalContactRoute } from "@/lib/portal-nav";
import LeadReportOverview, {
  type LeadSectionKey,
} from "@/app/components/portal/crm/LeadReportOverview";

type PortalContactLeadReportViewProps = {
  contactId: string;
  from?: string;
};

type SectionKey = LeadSectionKey;

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
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<SectionKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [enriching, setEnriching] = useState(false);
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

  useEffect(() => {
    setEditing(null);
    setNotice("");
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
        setEnriching(true);
        setNotice("Enriching with Apollo…");
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
            setNotice("Enriched with Apollo");
            window.setTimeout(() => {
              if (!cancelled) setNotice("");
            }, 2400);
          } else if (enrichResponse.status === 409) {
            setNotice("");
          } else {
            setNotice("");
            setError(enrichData.error || "Apollo enrich failed");
          }
        } catch (err) {
          if (!cancelled) {
            setNotice("");
            setError(
              err instanceof Error ? err.message : "Apollo enrich failed",
            );
          }
        } finally {
          if (!cancelled) {
            setEnriching(false);
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
    setNotice("");
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
    setNotice("");
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
      setNotice("Saved");
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
        <div className="crm-empty">Loading contact...</div>
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
        {enriching ? (
          <span className="lead-enrich-status" role="status">
            Enriching with Apollo…
          </span>
        ) : null}
        <div className="lead-report-toolbar-right">
          <div className="cd-pager">
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
      {notice ? <p className="fm-notice">{notice}</p> : null}
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
