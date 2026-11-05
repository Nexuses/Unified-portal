import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { USER_SESSION_COOKIE } from "@/lib/auth";
import { defaultPortalLandingHref } from "@/lib/portal-nav-access";
import type { PortalPageId } from "@/lib/portal-nav";

type UserDoc = {
  _id: ObjectId;
  fullName: string;
  email: string;
  passwordHash: string;
  projectId: ObjectId;
  accountType?: "standard" | "client_share";
  allowedNavPages?: PortalPageId[];
};

type ProjectDoc = {
  _id: ObjectId;
  name: string;
  logoUrl?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 },
      );
    }

    const db = await getDb();
    const user = await db.collection<UserDoc>("users").findOne({ email });

    if (!user) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 },
      );
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 },
      );
    }

    const project = await db.collection<ProjectDoc>("projects").findOne({
      _id: user.projectId,
    });

    const isClientShare = user.accountType === "client_share";
    const allowedNavPages: PortalPageId[] = isClientShare
      ? user.allowedNavPages || []
      : [];
    const redirectTo =
      isClientShare && allowedNavPages.length > 0
        ? defaultPortalLandingHref(allowedNavPages)
        : "/portal";

    const response = NextResponse.json({
      id: user._id.toString(),
      fullName: user.fullName,
      email: user.email,
      projectId: user.projectId.toString(),
      projectName: project?.name || "Unknown",
      projectLogoUrl: project?.logoUrl?.trim() || "",
      accountType: isClientShare ? "client_share" : "standard",
      ...(isClientShare ? { allowedNavPages } : {}),
      redirectTo,
    });

    response.cookies.set(USER_SESSION_COOKIE, user._id.toString(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch (error) {
    console.error("User login failed:", error);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
