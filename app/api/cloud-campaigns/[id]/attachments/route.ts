import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import {
  CLOUD_ATTACHMENT_MAX_FILES,
  CLOUD_ATTACHMENT_MAX_TOTAL,
  deleteCloudAttachment,
  storeCloudAttachment,
} from "@/lib/cloud-attachments";
import { getCloudCampaignDoc, patchCloudCampaignDoc } from "@/lib/cloud-campaigns-server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

/** Add files that go out with every email of this campaign. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const { id } = await params;
    const projectId = new ObjectId(session.projectId);
    const doc = await getCloudCampaignDoc(projectId, id);
    if (!doc) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    if (doc.status === "sending") {
      return NextResponse.json({ error: "Stop sending before changing attachments." }, { status: 409 });
    }
    const form = await request.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) return NextResponse.json({ error: "Choose a file." }, { status: 400 });
    const existing = doc.attachments || [];
    if (existing.length + files.length > CLOUD_ATTACHMENT_MAX_FILES) {
      return NextResponse.json({ error: `Up to ${CLOUD_ATTACHMENT_MAX_FILES} attachments.` }, { status: 400 });
    }
    const total = existing.reduce((sum, a) => sum + a.size, 0) + files.reduce((sum, f) => sum + f.size, 0);
    if (total > CLOUD_ATTACHMENT_MAX_TOTAL) {
      return NextResponse.json(
        { error: `Attachments can total up to ${Math.round(CLOUD_ATTACHMENT_MAX_TOTAL / 1024 / 1024)} MB per email.` },
        { status: 400 },
      );
    }
    const added = [];
    for (const file of files) {
      added.push(
        await storeCloudAttachment({
          projectId,
          campaignId: id,
          name: file.name,
          type: file.type,
          data: Buffer.from(await file.arrayBuffer()),
        }),
      );
    }
    const campaign = await patchCloudCampaignDoc(projectId, id, { attachments: [...existing, ...added] });
    return NextResponse.json({ campaign });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not add the attachment" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const { id } = await params;
    const projectId = new ObjectId(session.projectId);
    const attachmentId = request.nextUrl.searchParams.get("attachmentId") || "";
    const doc = await getCloudCampaignDoc(projectId, id);
    if (!doc) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    if (doc.status === "sending") {
      return NextResponse.json({ error: "Stop sending before changing attachments." }, { status: 409 });
    }
    const remaining = (doc.attachments || []).filter((a) => a.id !== attachmentId);
    if (remaining.length === (doc.attachments || []).length) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }
    await deleteCloudAttachment(attachmentId);
    const campaign = await patchCloudCampaignDoc(projectId, id, { attachments: remaining });
    return NextResponse.json({ campaign });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not remove the attachment" },
      { status: 500 },
    );
  }
}
