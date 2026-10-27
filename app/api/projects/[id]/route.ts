import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  DEFAULT_API_CREDIT_LIMIT_USD,
  normalizeApiCreditLimit,
} from "@/lib/api-credits";
import { getApiCreditUsedByProject } from "@/lib/api-credits-server";
import {
  DEFAULT_PROJECT_DATA_CREDITS,
  DEFAULT_PROJECT_SENDING_LIMIT,
  normalizeDataCredits,
  normalizeSendingLimit,
  slugify,
} from "@/lib/projects";
import { getDataCreditsUsedByProject } from "@/lib/data-credits-server";
import { deleteProjectCrmData } from "@/lib/crm-import";
import { deleteProjectSenders } from "@/lib/smtp-senders-server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type ProjectDoc = {
  _id: ObjectId;
  name: string;
  slug: string;
  logoUrl: string;
  users?: number;
  instantOpen?: boolean;
  instantClick?: boolean;
  sendingLimit?: number;
  dataCredits?: number;
  apiCreditLimitUsd?: number;
  /** @deprecated Prefer instantOpen / instantClick. */
  instantOpenClick?: boolean;
};

async function mapProject(doc: ProjectDoc) {
  const [used, apiUsed] = await Promise.all([
    getDataCreditsUsedByProject([doc._id]),
    getApiCreditUsedByProject([doc._id]),
  ]);
  return {
    id: doc._id.toString(),
    name: doc.name,
    slug: doc.slug,
    logoUrl: doc.logoUrl ?? "",
    users: doc.users ?? 0,
    instantOpen: true,
    instantClick: true,
    sendingLimit: normalizeSendingLimit(
      doc.sendingLimit ?? DEFAULT_PROJECT_SENDING_LIMIT,
    ),
    dataCredits: normalizeDataCredits(doc.dataCredits ?? DEFAULT_PROJECT_DATA_CREDITS),
    dataCreditsUsed: used.get(doc._id.toString()) ?? 0,
    apiCreditLimitUsd: normalizeApiCreditLimit(
      doc.apiCreditLimitUsd ?? DEFAULT_API_CREDIT_LIMIT_USD,
    ),
    apiCreditUsedUsd: apiUsed.get(doc._id.toString()) ?? 0,
  };
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    const body = await request.json();
    const name = String(body.name ?? "").trim();
    const logoUrl = String(body.logoUrl ?? "").trim();
    const slugInput = String(body.slug ?? "").trim();
    const sendingLimit =
      body.sendingLimit !== undefined
        ? normalizeSendingLimit(body.sendingLimit)
        : undefined;
    const dataCredits =
      body.dataCredits !== undefined ? normalizeDataCredits(body.dataCredits) : undefined;
    const apiCreditLimitUsd =
      body.apiCreditLimitUsd !== undefined
        ? normalizeApiCreditLimit(body.apiCreditLimitUsd)
        : undefined;

    if (!name) {
      return NextResponse.json(
        { error: "Project name is required" },
        { status: 400 },
      );
    }

    const slug = slugify(slugInput || name);
    if (!slug) {
      return NextResponse.json(
        { error: "A valid slug is required" },
        { status: 400 },
      );
    }

    const db = await getDb();
    const objectId = new ObjectId(id);

    const duplicate = await db.collection("projects").findOne({
      slug,
      _id: { $ne: objectId },
    });

    if (duplicate) {
      return NextResponse.json(
        { error: "A project with this slug already exists" },
        { status: 409 },
      );
    }

    const $set: Record<string, unknown> = {
      name,
      slug,
      logoUrl,
      instantOpen: true,
      instantClick: true,
      updatedAt: new Date(),
    };
    if (typeof sendingLimit === "number") {
      $set.sendingLimit = sendingLimit;
    }
    if (typeof dataCredits === "number") {
      $set.dataCredits = dataCredits;
    }
    if (typeof apiCreditLimitUsd === "number") {
      $set.apiCreditLimitUsd = apiCreditLimitUsd;
    }

    const result = await db.collection("projects").findOneAndUpdate(
      { _id: objectId },
      { $set },
      { returnDocument: "after" },
    );

    if (!result) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json(await mapProject(result as ProjectDoc));
  } catch (error) {
    console.error("Failed to update project:", error);
    return NextResponse.json(
      { error: "Failed to update project" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    const body = await request.json();
    const $set: Record<string, unknown> = { updatedAt: new Date() };
    let hasUpdate = false;

    if (body.sendingLimit !== undefined) {
      $set.sendingLimit = normalizeSendingLimit(body.sendingLimit);
      hasUpdate = true;
    }
    if (body.dataCredits !== undefined) {
      $set.dataCredits = normalizeDataCredits(body.dataCredits);
      hasUpdate = true;
    }
    if (body.apiCreditLimitUsd !== undefined) {
      $set.apiCreditLimitUsd = normalizeApiCreditLimit(body.apiCreditLimitUsd);
      hasUpdate = true;
    }

    if (!hasUpdate) {
      return NextResponse.json(
        {
          error:
            "Provide sendingLimit, dataCredits, and/or apiCreditLimitUsd to update",
        },
        { status: 400 },
      );
    }

    const db = await getDb();
    const result = await db.collection("projects").findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set },
      { returnDocument: "after" },
    );

    if (!result) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json(await mapProject(result as ProjectDoc));
  } catch (error) {
    console.error("Failed to update project:", error);
    return NextResponse.json(
      { error: "Failed to update project" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    const db = await getDb();
    const projectObjectId = new ObjectId(id);

    const project = await db.collection("projects").findOne({
      _id: projectObjectId,
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    await db.collection("users").deleteMany({ projectId: projectObjectId });
    await deleteProjectCrmData(projectObjectId);
    await deleteProjectSenders(projectObjectId);
    await db.collection("projects").deleteOne({ _id: projectObjectId });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete project:", error);
    return NextResponse.json(
      { error: "Failed to delete project" },
      { status: 500 },
    );
  }
}
