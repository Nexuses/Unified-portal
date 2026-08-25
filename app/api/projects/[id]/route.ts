import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { slugify } from "@/lib/projects";
import { deleteProjectCrmData } from "@/lib/crm-import";
import { deleteProjectSenders } from "@/lib/smtp-senders-server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

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

    const result = await db.collection("projects").findOneAndUpdate(
      { _id: objectId },
      {
        $set: {
          name,
          slug,
          logoUrl,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" },
    );

    if (!result) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: result._id.toString(),
      name: result.name,
      slug: result.slug,
      logoUrl: result.logoUrl,
      users: result.users ?? 0,
    });
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
