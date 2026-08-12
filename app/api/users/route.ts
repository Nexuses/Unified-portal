import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/mongodb";

type UserDoc = {
  _id: ObjectId;
  fullName: string;
  email: string;
  passwordHash: string;
  projectId: ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

type ProjectDoc = {
  _id: ObjectId;
  name: string;
  users?: number;
};

function mapUser(doc: UserDoc, projectName: string) {
  return {
    id: doc._id.toString(),
    fullName: doc.fullName,
    email: doc.email,
    projectId: doc.projectId.toString(),
    projectName,
  };
}

export async function GET() {
  try {
    const db = await getDb();
    const users = await db
      .collection<UserDoc>("users")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    const projectIds = [
      ...new Set(users.map((user) => user.projectId.toString())),
    ].map((id) => new ObjectId(id));

    const projects = await db
      .collection<ProjectDoc>("projects")
      .find({ _id: { $in: projectIds } })
      .toArray();

    const projectMap = new Map(
      projects.map((project) => [project._id.toString(), project.name]),
    );

    return NextResponse.json(
      users.map((user) =>
        mapUser(user, projectMap.get(user.projectId.toString()) || "Unknown"),
      ),
    );
  } catch (error) {
    console.error("Failed to fetch users:", error);
    return NextResponse.json(
      { error: "Failed to fetch users" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const fullName = String(body.fullName ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const projectId = String(body.projectId ?? "").trim();

    if (!fullName || !email || !password || !projectId) {
      return NextResponse.json(
        { error: "Full name, email, password, and project are required" },
        { status: 400 },
      );
    }

    if (!ObjectId.isValid(projectId)) {
      return NextResponse.json({ error: "Invalid project" }, { status: 400 });
    }

    const db = await getDb();
    const projectObjectId = new ObjectId(projectId);
    const project = await db
      .collection<ProjectDoc>("projects")
      .findOne({ _id: projectObjectId });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const existing = await db.collection("users").findOne({ email });
    if (existing) {
      return NextResponse.json(
        { error: "A user with this email already exists" },
        { status: 409 },
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const doc = {
      fullName,
      email,
      passwordHash,
      projectId: projectObjectId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection("users").insertOne(doc);
    await db.collection("projects").updateOne(
      { _id: projectObjectId },
      { $inc: { users: 1 } },
    );

    return NextResponse.json(
      {
        id: result.insertedId.toString(),
        fullName,
        email,
        projectId,
        projectName: project.name,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to create user:", error);
    return NextResponse.json(
      { error: "Failed to create user" },
      { status: 500 },
    );
  }
}
