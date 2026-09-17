import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  DEFAULT_PROJECT_SENDING_LIMIT,
  normalizeSendingLimit,
  slugify,
} from "@/lib/projects";

type ProjectDoc = {
  _id: ObjectId;
  name: string;
  slug: string;
  logoUrl: string;
  users: number;
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
    logoUrl: doc.logoUrl,
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

export async function GET() {
  try {
    const db = await getDb();
    const docs = await db
      .collection<ProjectDoc>("projects")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    return NextResponse.json(docs.map(mapProject));
  } catch (error) {
    console.error("Failed to fetch projects:", error);
    return NextResponse.json(
      { error: "Failed to fetch projects" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = String(body.name ?? "").trim();
    const logoUrl = String(body.logoUrl ?? "").trim();
    const slugInput = String(body.slug ?? "").trim();
    const instantOpen = Boolean(body.instantOpen);
    const instantClick = Boolean(body.instantClick);
    const sendingLimit = normalizeSendingLimit(
      body.sendingLimit ?? DEFAULT_PROJECT_SENDING_LIMIT,
    );

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
    const existing = await db.collection("projects").findOne({ slug });
    if (existing) {
      return NextResponse.json(
        { error: "A project with this slug already exists" },
        { status: 409 },
      );
    }

    const doc = {
      name,
      slug,
      logoUrl,
      users: 0,
      instantOpen,
      instantClick,
      sendingLimit,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection("projects").insertOne(doc);

    return NextResponse.json(
      {
        id: result.insertedId.toString(),
        name: doc.name,
        slug: doc.slug,
        logoUrl: doc.logoUrl,
        users: doc.users,
        instantOpen: doc.instantOpen,
        instantClick: doc.instantClick,
        sendingLimit: doc.sendingLimit,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to create project:", error);
    return NextResponse.json(
      { error: "Failed to create project" },
      { status: 500 },
    );
  }
}
