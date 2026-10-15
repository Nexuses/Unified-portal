"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Loader2,
} from "lucide-react";
import type {
  AssistantPitchResearchCard,
  PitchCompanyResult,
  PitchPerson,
  PitchResearchJob,
} from "@/lib/pitch-research";

const POLL_MS = 4000;

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Badge({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
  const tone =
    ok === true
      ? "bg-emerald-50 text-emerald-700"
      : ok === false
        ? "bg-amber-50 text-amber-800"
        : "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>
      {children}
    </span>
  );
}

function PersonPitch({ person }: { person: PitchPerson }) {
  const [copied, setCopied] = useState(false);
  const { validation } = person;

  async function copyPitch() {
    const text = `Subject: ${person.pitch.subject}\n\n${person.pitch.body}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt("Copy this pitch", text);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5">
      <div className="flex flex-wrap items-start justify-between gap-1.5">
        <div className="min-w-0">
          <p className="m-0 text-xs font-semibold text-slate-800">
            {person.name}
            {person.linkedin ? (
              <a
                href={person.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1 inline-flex align-middle text-violet-600"
                title="LinkedIn"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </p>
          <p className="m-0 text-[11px] text-slate-500">
            {[person.title, person.location].filter(Boolean).join(" · ") || "—"}
          </p>
          {person.email ? (
            <p className="m-0 text-[11px] text-slate-600">{person.email}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge ok={validation.inDataPortal}>
            {validation.inDataPortal ? "In Data Portal" : "Web only"}
          </Badge>
          {validation.titleMatches !== null ? (
            <Badge ok={validation.titleMatches}>
              {validation.titleMatches ? "Title matches" : "Title differs"}
            </Badge>
          ) : null}
          {person.email ? (
            <Badge ok={validation.emailVerified}>
              {validation.emailVerified ? "Email verified" : person.emailStatus || "Email unverified"}
            </Badge>
          ) : null}
        </div>
      </div>

      {person.insights.length ? (
        <ul className="m-0 mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] text-slate-600">
          {person.insights.map((insight, index) => (
            <li key={index}>{insight}</li>
          ))}
        </ul>
      ) : null}

      {person.pitch.body ? (
        <div className="mt-2 rounded-md bg-violet-50/60 p-2">
          <div className="flex items-start justify-between gap-2">
            <p className="m-0 text-[11px] font-semibold text-slate-800">{person.pitch.subject}</p>
            <button
              type="button"
              onClick={() => void copyPitch()}
              className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-violet-700 hover:bg-violet-100"
            >
              <Copy className="h-3 w-3" />
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="m-0 mt-1 whitespace-pre-line text-[11px] leading-relaxed text-slate-700">
            {person.pitch.body}
          </p>
        </div>
      ) : null}

      {validation.notes.length ? (
        <p className="m-0 mt-1.5 text-[10px] leading-snug text-slate-500">
          {validation.notes.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

function CompanySection({ company }: { company: PitchCompanyResult }) {
  const [open, setOpen] = useState(false);
  const research = company.research;
  const done = company.status === "done";

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={!done}
        className="flex w-full items-center gap-2 px-3 py-2 text-left disabled:cursor-default"
      >
        {company.status === "done" ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
        ) : company.status === "failed" ? (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
        ) : company.status === "researching" ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-violet-600" />
        ) : (
          <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-slate-300" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800">
          {company.name}
        </span>
        <span className="shrink-0 text-[11px] text-slate-500">
          {done
            ? `${company.people.length} ${company.people.length === 1 ? "pitch" : "pitches"}`
            : company.status === "failed"
              ? "Failed"
              : company.status === "researching"
                ? "Researching…"
                : "Queued"}
        </span>
        {done ? (
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`}
          />
        ) : null}
      </button>
      {company.status === "failed" && company.error ? (
        <p className="m-0 px-3 pb-2 text-[11px] text-amber-800">{company.error}</p>
      ) : null}

      {open && research ? (
        <div className="space-y-2.5 bg-slate-50/70 px-3 pb-3 pt-1">
          <div className="flex flex-wrap gap-1">
            {research.website ? (
              <a
                href={research.website.startsWith("http") ? research.website : `https://${research.website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-slate-200"
              >
                <Globe className="h-3 w-3" />
                {hostname(research.website)}
              </a>
            ) : null}
            {[research.industry, research.size, research.location].filter(Boolean).map((value) => (
              <span
                key={value}
                className="rounded-full bg-white px-2 py-0.5 text-[10px] text-slate-600 ring-1 ring-slate-200"
              >
                {value}
              </span>
            ))}
            <Badge ok={research.companyMatchesPortal}>
              {research.companyMatchesPortal
                ? `Data Portal: ${research.portal.matchedName} · ${research.portal.people} people`
                : "Not found in Data Portal"}
            </Badge>
          </div>

          {research.summary ? (
            <p className="m-0 text-[11px] leading-relaxed text-slate-700">{research.summary}</p>
          ) : null}

          {research.priorities.length ? (
            <div>
              <p className="m-0 mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Priorities
              </p>
              <ul className="m-0 list-disc space-y-0.5 pl-4 text-[11px] text-slate-700">
                {research.priorities.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {research.news.length ? (
            <div>
              <p className="m-0 mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Recent news
              </p>
              <ul className="m-0 space-y-0.5 pl-0 text-[11px]">
                {research.news.map((item, index) => (
                  <li key={index} className="list-none text-slate-700">
                    {item.url ? (
                      <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-violet-700 hover:underline">
                        {item.title}
                      </a>
                    ) : (
                      item.title
                    )}
                    {item.date ? <span className="text-slate-400"> · {item.date}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-2">
            <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              People and pitches
            </p>
            {company.people.length ? (
              company.people.map((person, index) => <PersonPitch key={index} person={person} />)
            ) : (
              <p className="m-0 text-[11px] text-slate-500">No suitable people found.</p>
            )}
          </div>

          {company.sources.length ? (
            <div>
              <p className="m-0 mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Sources
              </p>
              <div className="flex flex-wrap gap-1">
                {company.sources.slice(0, 12).map((source) => (
                  <a
                    key={source.url}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={source.title || source.url}
                    className="max-w-[180px] truncate rounded-full bg-white px-2 py-0.5 text-[10px] text-slate-600 ring-1 ring-slate-200 hover:text-violet-700"
                  >
                    {hostname(source.url)}
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function PortalPitchResearchCard({ card }: { card: AssistantPitchResearchCard }) {
  const [job, setJob] = useState<PitchResearchJob | null>(null);
  const [error, setError] = useState("");
  const finished = job?.status === "done" || job?.status === "failed";

  useEffect(() => {
    if (finished) return;
    let cancelled = false;
    let timer = 0;
    async function load() {
      try {
        const response = await fetch(`/api/pitch-research/${card.jobId}`, { cache: "no-store" });
        const data = (await response.json().catch(() => ({}))) as {
          job?: PitchResearchJob;
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || !data.job) throw new Error(data.error || "Could not load research");
        setError("");
        setJob(data.job);
        if (data.job.status === "done" || data.job.status === "failed") return;
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load research");
      }
      timer = window.setTimeout(load, POLL_MS);
    }
    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [card.jobId, finished]);

  const total = job?.total ?? card.total;
  const completed = job?.completed ?? 0;
  const percent = total ? Math.round((completed / total) * 100) : 0;
  const pitches = job?.companies.reduce((sum, company) => sum + company.people.length, 0) ?? 0;

  return (
    <div className="pa-people-card mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white text-left">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Pitch research · {total} {total === 1 ? "company" : "companies"}
        </p>
        {finished && pitches > 0 ? (
          <a
            href={`/api/pitch-research/${card.jobId}/export`}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-violet-700 transition hover:bg-violet-100"
          >
            <Download className="h-3.5 w-3.5" />
            Excel
          </a>
        ) : null}
      </div>

      <div className="border-b border-slate-100 px-3 py-2">
        <div className="flex items-center justify-between text-[11px] text-slate-600">
          <span>
            {job?.status === "failed"
              ? job.error || "Research failed"
              : finished
                ? `Done · ${pitches} ${pitches === 1 ? "pitch" : "pitches"}`
                : `Researching ${completed} of ${total}…`}
          </span>
          <span>{percent}%</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-(--purple) transition-all duration-500"
            style={{ width: `${Math.max(percent, finished ? 100 : 4)}%` }}
          />
        </div>
        {job?.focus ? (
          <p className="m-0 mt-1 text-[10px] text-slate-500">Angle: {job.focus}</p>
        ) : null}
      </div>

      {error ? <p className="m-0 px-3 py-2 text-xs text-red-600">{error}</p> : null}

      {job ? (
        <div className="max-h-[28rem] overflow-auto">
          {job.companies.map((company, index) => (
            <CompanySection key={`${company.name}-${index}`} company={company} />
          ))}
        </div>
      ) : !error ? (
        <div className="flex items-center gap-2 px-3 py-4 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Starting research…
        </div>
      ) : null}
    </div>
  );
}
