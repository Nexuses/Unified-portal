import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/mongodb";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type UserDoc = {
  _id: ObjectId;
  fullName: string;
  email: string;
  passwordHash: string;
  projectId: ObjectId;
};

type ProjectDoc = {
  _id: ObjectId;
  name: string;
};

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    }

    const body = await request.json();
    const fullName = String(body.fullName ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const projectId = String(body.projectId ?? "").trim();

    if (!fullName || !email || !projectId) {
      return NextResponse.json(
        { error: "Full name, email, and project are required" },
        { status: 400 },
      );
    }

    if (!ObjectId.isValid(projectId)) {
      return NextResponse.json({ error: "Invalid project" }, { status: 400 });
    }

    const db = await getDb();
    const userObjectId = new ObjectId(id);
    const projectObjectId = new ObjectId(projectId);

    const existingUser = await db
      .collection<UserDoc>("users")
      .findOne({ _id: userObjectId });

    if (!existingUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const project = await db
      .collection<ProjectDoc>("projects")
      .findOne({ _id: projectObjectId });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const emailTaken = await db.collection("users").findOne({
      email,
      _id: { $ne: userObjectId },
    });

    if (emailTaken) {
      return NextResponse.json(
        { error: "A user with this email already exists" },
        { status: 409 },
      );
    }

    const updateFields: Record<string, unknown> = {
      fullName,
      email,
      projectId: projectObjectId,
      updatedAt: new Date(),
    };

    if (password.trim()) {
      updateFields.passwordHash = await bcrypt.hash(password, 10);
    }

    await db.collection("users").updateOne(
      { _id: userObjectId },
      { $set: updateFields },
    );

    const oldProjectId = existingUser.projectId.toString();
    const newProjectId = projectObjectId.toString();

    if (oldProjectId !== newProjectId) {
      await db
        .collection("projects")
        .updateOne({ _id: existingUser.projectId }, { $inc: { users: -1 } });
      await db
        .collection("projects")
        .updateOne({ _id: projectObjectId }, { $inc: { users: 1 } });
    }

    return NextResponse.json({
      id,
      fullName,
      email,
      projectId: newProjectId,
      projectName: project.name,
    });
  } catch (error) {
    console.error("Failed to update user:", error);
    return NextResponse.json(
      { error: "Failed to update user" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    }

    const db = await getDb();
    const userObjectId = new ObjectId(id);
    const existingUser = await db
      .collection<UserDoc>("users")
      .findOne({ _id: userObjectId });

    if (!existingUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    await db.collection("users").deleteOne({ _id: userObjectId });
    await db
      .collection("projects")
      .updateOne({ _id: existingUser.projectId }, { $inc: { users: -1 } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete user:", error);
    return NextResponse.json(
      { error: "Failed to delete user" },
      { status: 500 },
    );
  }
}
