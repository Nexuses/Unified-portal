"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ContactDetail, ContactProfile } from "@/lib/crm";
import {
  portalContactRoute,
  portalReturnPath,
  PORTAL_ROUTES,
} from "@/lib/portal-nav";
import LeadReportOverview, {
  type LeadSectionKey,
} from "@/app/components/portal/crm/LeadReportOverview";

type PortalContactDetailPageProps = {
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

export default function PortalContactDetailPage({
  contactId,
  from,
}: PortalContactDetailPageProps) {
  const router = useRouter();
  const backHref = portalReturnPath(from, PORTAL_ROUTES.contacts);
  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<SectionKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [enriching, setEnriching] = useState(false);
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
  }, [contactId]);

  useEffect(() => {
    async function loadContact() {
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
        setContact(data);
        setDraftProfile(cloneProfile(data.profile));
        setDraftCore({
          firstName: data.firstName || "",
          lastName: data.lastName || "",
          email: data.email || "",
          companyName: data.companyName || "",
          attributes: { ...(data.attributes || {}) },
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load contact");
      } finally {
        setLoading(false);
      }
    }

    void loadContact();
  }, [contactId]);

  const profile = contact?.profile || emptyProfile();
  const alreadyEnriched = Boolean(profile.apollo?.enrichedAt);
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
      setContact(data);
      setDraftProfile(cloneProfile(data.profile));
      setDraftCore({
        firstName: data.firstName || "",
        lastName: data.lastName || "",
        email: data.email || "",
        companyName: data.companyName || "",
        attributes: { ...(data.attributes || {}) },
      });
      setEditing(null);
      setNotice("Saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function enrichOnce() {
    if (!contact || alreadyEnriched || enriching) return;
    setEnriching(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/crm/contacts/${contact.id}/apollo-enrich`,
        { method: "POST" },
      );
      const data = (await response.json()) as ContactDetail & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Apollo enrich failed");
      }
      setContact(data);
      setDraftProfile(cloneProfile(data.profile));
      setDraftCore({
        firstName: data.firstName || "",
        lastName: data.lastName || "",
        email: data.email || "",
        companyName: data.companyName || "",
        attributes: { ...(data.attributes || {}) },
      });
      setNotice("Enriched with Apollo and saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apollo enrich failed");
    } finally {
      setEnriching(false);
    }
  }

  function patchProfile(updater: (current: ContactProfile) => ContactProfile) {
    setDraftProfile((current) => updater(cloneProfile(current)));
  }

  if (loading) {
    return <div className="crm-empty">Loading contact...</div>;
  }

  if (error && !contact) {
    return (
      <>
        <div className="cd-top">
          <div className="cd-identity">
            <button
              type="button"
              className="cd-back"
              aria-label="Back"
              onClick={() => router.push(backHref)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
          </div>
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
      <div className="lead-top-actions cd-contact-tools">
        <button
          type="button"
          className="cd-back"
          aria-label="Back"
          onClick={() => router.push(backHref)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <button
          type="button"
          className="btn-dark"
          disabled={enriching || alreadyEnriched || Boolean(editing)}
          title={
            alreadyEnriched
              ? "Already enriched once with Apollo"
              : "Enrich once from Apollo by email"
          }
          onClick={() => void enrichOnce()}
        >
          {enriching
            ? "Enriching…"
            : alreadyEnriched
              ? "Apollo enriched"
              : "Enrich with Apollo"}
        </button>
        <div className="cd-pager">
          <button
            type="button"
            aria-label="Previous contact"
            disabled={!navigation?.prevId}
            onClick={() =>
              navigation?.prevId
                ? router.push(portalContactRoute(navigation.prevId, from))
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
                ? router.push(portalContactRoute(navigation.nextId, from))
                : undefined
            }
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>
      </div>

      {error ? <p className="crm-error">{error}</p> : null}
      {notice ? <p className="fm-notice">{notice}</p> : null}

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
