import { NextRequest, NextResponse } from "next/server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";
import {
  companiesFromUpload,
  createPitchResearchJob,
  normalizeCompanyInputs,
} from "@/lib/pitch-research-server";
import type { AssistantPitchResearchCard } from "@/lib/pitch-research";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Starts a research job from an uploaded company list (multipart) or a JSON list of names. */
export async function POST(request: NextRequest) {
  const session = await requirePortalSession();
  if (isSessionError(session)) return session;

  try {
    let parsed: ReturnType<typeof normalizeCompanyInputs>;
    let focus = "";
    let sourceName = "Company list";

    if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      focus = String(form.get("focus") ?? "");
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json({ error: "Choose a company list to upload." }, { status: 400 });
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: "Company lists can be up to 5 MB." }, { status: 400 });
      }
      sourceName = file.name;
      parsed = await companiesFromUpload(file.name, Buffer.from(await file.arrayBuffer()));
    } else {
      const body = (await request.json().catch(() => ({}))) as {
        companies?: unknown;
        focus?: unknown;
      };
      focus = String(body.focus ?? "");
      const names = Array.isArray(body.companies) ? body.companies.map(String) : [];
      parsed = normalizeCompanyInputs(names.map((name) => ({ name })));
    }

    if (parsed.companies.length === 0) {
      return NextResponse.json(
        { error: "No company names found. Put them in a column named Company." },
        { status: 400 },
      );
    }

    const job = await createPitchResearchJob({
      projectId: session.projectId,
      projectName: session.projectName,
      createdBy: session.fullName || session.email,
      companies: parsed.companies,
      focus,
      sourceName,
    });
    const card: AssistantPitchResearchCard = {
      kind: "pitch-research",
      jobId: job.id,
      total: job.total,
      sourceName,
    };
    return NextResponse.json({ card, skipped: parsed.skipped }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start research";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
