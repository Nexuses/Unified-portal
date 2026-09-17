import { cookies } from "next/headers";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { AdminDoc, SessionAdmin } from "@/lib/admins";
import {
  DEFAULT_PROJECT_SENDING_LIMIT,
  normalizeSendingLimit,
} from "@/lib/projects";

export const USER_SESSION_COOKIE = "portal_user_session";
export const ADMIN_SESSION_COOKIE = "portal_admin_session";

export type SessionUser = {
  id: string;
  fullName: string;
  email: string;
  projectId: string;
  projectName: string;
  projectLogoUrl: string;
  sendingLimit: number;
};

export type { SessionAdmin };

type UserDoc = {
  _id: ObjectId;
  fullName: string;
  email: string;
  projectId: ObjectId;
};

type ProjectDoc = {
  _id: ObjectId;
  name: string;
  logoUrl?: string;
  sendingLimit?: number;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const userId = cookieStore.get(USER_SESSION_COOKIE)?.value;

  if (!userId || !ObjectId.isValid(userId)) {
    return null;
  }

  const db = await getDb();
  const user = await db.collection<UserDoc>("users").findOne({
    _id: new ObjectId(userId),
  });

  if (!user) {
    return null;
  }

  const project = await db.collection<ProjectDoc>("projects").findOne({
    _id: user.projectId,
  });

  return {
    id: user._id.toString(),
    fullName: user.fullName,
    email: user.email,
    projectId: user.projectId.toString(),
    projectName: project?.name || "Unknown",
    projectLogoUrl: project?.logoUrl?.trim() || "",
    sendingLimit: normalizeSendingLimit(
      project?.sendingLimit ?? DEFAULT_PROJECT_SENDING_LIMIT,
    ),
  };
}

export async function getSessionAdmin(): Promise<SessionAdmin | null> {
  const cookieStore = await cookies();
  const adminId = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;

  if (!adminId || !ObjectId.isValid(adminId)) {
    return null;
  }

  const db = await getDb();
  const admin = await db.collection<AdminDoc>("admins").findOne({
    _id: new ObjectId(adminId),
  });

  if (!admin) {
    return null;
  }

  return {
    id: admin._id.toString(),
    email: admin.email,
    fullName: admin.fullName,
  };
}
