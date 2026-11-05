import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/mongodb";
import {
  normalizeAllowedNavPages,
  type AssignableNavOption,
  listAssignableNavOptions,
} from "@/lib/portal-nav-access";
import type { PortalPageId } from "@/lib/portal-nav";

export type ClientShareUser = {
  id: string;
  fullName: string;
  email: string;
  projectId: string;
  projectName: string;
  allowedNavPages: PortalPageId[];
  createdAt?: string;
  updatedAt?: string;
};

type UserDoc = {
  _id: ObjectId;
  fullName: string;
  email: string;
  passwordHash: string;
  projectId: ObjectId;
  accountType?: "standard" | "client_share";
  allowedNavPages?: PortalPageId[];
  createdAt: Date;
  updatedAt: Date;
};

type ProjectDoc = {
  _id: ObjectId;
  name: string;
  users?: number;
};

function mapClientShareUser(
  doc: UserDoc,
  projectName: string,
): ClientShareUser {
  return {
    id: doc._id.toString(),
    fullName: doc.fullName,
    email: doc.email,
    projectId: doc.projectId.toString(),
    projectName,
    allowedNavPages: doc.allowedNavPages || [],
    createdAt: doc.createdAt?.toISOString?.(),
    updatedAt: doc.updatedAt?.toISOString?.(),
  };
}

export function assignableNavOptions(): AssignableNavOption[] {
  return listAssignableNavOptions();
}

export async function listClientShareUsers(): Promise<ClientShareUser[]> {
  const db = await getDb();
  const users = await db
    .collection<UserDoc>("users")
    .find({ accountType: "client_share" })
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

  return users.map((user) =>
    mapClientShareUser(
      user,
      projectMap.get(user.projectId.toString()) || "Unknown",
    ),
  );
}

export async function createClientShareUser(input: {
  fullName: string;
  email: string;
  password: string;
  projectId: string;
  allowedNavPages: unknown;
}): Promise<ClientShareUser> {
  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  const projectId = input.projectId.trim();
  const allowedNavPages = normalizeAllowedNavPages(input.allowedNavPages) || [];

  if (!fullName || !email || !password || !projectId) {
    throw new Error("Full name, email, password, and project are required.");
  }
  if (!ObjectId.isValid(projectId)) {
    throw new Error("Invalid project.");
  }
  if (allowedNavPages.length === 0) {
    throw new Error("Select at least one portal section the client can view.");
  }

  const db = await getDb();
  const projectObjectId = new ObjectId(projectId);
  const project = await db
    .collection<ProjectDoc>("projects")
    .findOne({ _id: projectObjectId });
  if (!project) {
    throw new Error("Project not found.");
  }

  const existing = await db.collection<UserDoc>("users").findOne({ email });
  if (existing) {
    throw new Error("A user with this email already exists.");
  }

  const now = new Date();
  const doc: UserDoc = {
    _id: new ObjectId(),
    fullName,
    email,
    passwordHash: await bcrypt.hash(password, 10),
    projectId: projectObjectId,
    accountType: "client_share",
    allowedNavPages,
    createdAt: now,
    updatedAt: now,
  };

  await db.collection<UserDoc>("users").insertOne(doc);
  await db
    .collection<ProjectDoc>("projects")
    .updateOne({ _id: projectObjectId }, { $inc: { users: 1 } });

  return mapClientShareUser(doc, project.name);
}

export async function updateClientShareUser(
  userId: ObjectId,
  input: {
    fullName: string;
    email: string;
    password?: string;
    projectId: string;
    allowedNavPages: unknown;
  },
): Promise<ClientShareUser | null> {
  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  const projectId = input.projectId.trim();
  const allowedNavPages = normalizeAllowedNavPages(input.allowedNavPages) || [];

  if (!fullName || !email || !projectId) {
    throw new Error("Full name, email, and project are required.");
  }
  if (!ObjectId.isValid(projectId)) {
    throw new Error("Invalid project.");
  }
  if (allowedNavPages.length === 0) {
    throw new Error("Select at least one portal section the client can view.");
  }

  const db = await getDb();
  const existing = await db.collection<UserDoc>("users").findOne({
    _id: userId,
    accountType: "client_share",
  });
  if (!existing) {
    return null;
  }

  const projectObjectId = new ObjectId(projectId);
  const project = await db
    .collection<ProjectDoc>("projects")
    .findOne({ _id: projectObjectId });
  if (!project) {
    throw new Error("Project not found.");
  }

  const emailTaken = await db.collection<UserDoc>("users").findOne({
    email,
    _id: { $ne: userId },
  });
  if (emailTaken) {
    throw new Error("A user with this email already exists.");
  }

  const $set: Record<string, unknown> = {
    fullName,
    email,
    projectId: projectObjectId,
    allowedNavPages,
    updatedAt: new Date(),
  };
  if (input.password?.trim()) {
    $set.passwordHash = await bcrypt.hash(input.password.trim(), 10);
  }

  await db.collection<UserDoc>("users").updateOne({ _id: userId }, { $set });

  const oldProjectId = existing.projectId.toString();
  const newProjectId = projectObjectId.toString();
  if (oldProjectId !== newProjectId) {
    await db
      .collection<ProjectDoc>("projects")
      .updateOne({ _id: existing.projectId }, { $inc: { users: -1 } });
    await db
      .collection<ProjectDoc>("projects")
      .updateOne({ _id: projectObjectId }, { $inc: { users: 1 } });
  }

  const updated = await db.collection<UserDoc>("users").findOne({ _id: userId });
  return updated ? mapClientShareUser(updated, project.name) : null;
}

export async function deleteClientShareUser(userId: ObjectId): Promise<boolean> {
  const db = await getDb();
  const existing = await db.collection<UserDoc>("users").findOne({
    _id: userId,
    accountType: "client_share",
  });
  if (!existing) {
    return false;
  }

  await db.collection<UserDoc>("users").deleteOne({ _id: userId });
  await db
    .collection<ProjectDoc>("projects")
    .updateOne({ _id: existing.projectId }, { $inc: { users: -1 } });
  return true;
}
