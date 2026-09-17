import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  DEFAULT_PROJECT_SENDING_LIMIT,
  normalizeSendingLimit,
  slugify,
} from "@/lib/projects";
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
  /** @deprecated Prefer instantOpen / instantClick. */
  instantOpenClick?: boolean;
};

function mapProject(doc: ProjectDoc) {
  const legacyBoth = Boolean(doc.instantOpenClick);
  return {
    id: doc._id.toString(),
    name: doc.name,
    slug: doc.slug,
    logoUrl: doc.logoUrl ?? "",
    users: doc.users ?? 0,
    instantOpen:
      typeof doc.instantOpen === "boolean" ? doc.instantOpen : legacyBoth,
    instantClick:
      typeof doc.instantClick === "boolean" ? doc.instantClick : legacyBoth,
    sendingLimit: normalizeSendingLimit(
      doc.sendingLimit ?? DEFAULT_PROJECT_SENDING_LIMIT,
    ),
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
    const instantOpen =
      typeof body.instantOpen === "boolean" ? body.instantOpen : undefined;
    const instantClick =
      typeof body.instantClick === "boolean" ? body.instantClick : undefined;
    const sendingLimit =
      body.sendingLimit !== undefined
        ? normalizeSendingLimit(body.sendingLimit)
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
      updatedAt: new Date(),
    };
    if (typeof instantOpen === "boolean") {
      $set.instantOpen = instantOpen;
    }
    if (typeof instantClick === "boolean") {
      $set.instantClick = instantClick;
    }
    if (typeof sendingLimit === "number") {
      $set.sendingLimit = sendingLimit;
    }

    const result = await db.collection("projects").findOneAndUpdate(
      { _id: objectId },
      { $set },
      { returnDocument: "after" },
    );

    if (!result) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json(mapProject(result as ProjectDoc));
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

    if (typeof body.instantOpen === "boolean") {
      $set.instantOpen = body.instantOpen;
      hasUpdate = true;
    }
    if (typeof body.instantClick === "boolean") {
      $set.instantClick = body.instantClick;
      hasUpdate = true;
    }
    if (body.sendingLimit !== undefined) {
      $set.sendingLimit = normalizeSendingLimit(body.sendingLimit);
      hasUpdate = true;
    }

    if (!hasUpdate) {
      return NextResponse.json(
        {
          error:
            "Provide instantOpen, instantClick, and/or sendingLimit to update",
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

    return NextResponse.json(mapProject(result as ProjectDoc));
  } catch (error) {
    console.error("Failed to patch project:", error);
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
