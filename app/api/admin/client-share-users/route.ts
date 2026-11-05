import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  assignableNavOptions,
  createClientShareUser,
  listClientShareUsers,
} from "@/lib/client-share-users-server";
import {
  isAdminSessionError,
  requireAdminSession,
} from "@/lib/require-admin-session";

export async function GET() {
  try {
    const admin = await requireAdminSession();
    if (isAdminSessionError(admin)) {
      return admin;
    }

    const [users, navOptions] = await Promise.all([
      listClientShareUsers(),
      Promise.resolve(assignableNavOptions()),
    ]);

    return NextResponse.json({ users, navOptions });
  } catch (error) {
    console.error("Failed to list client share users:", error);
    return NextResponse.json(
      { error: "Failed to list client share logins" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminSession();
    if (isAdminSessionError(admin)) {
      return admin;
    }

    const body = (await request.json().catch(() => null)) as {
      fullName?: string;
      email?: string;
      password?: string;
      projectId?: string;
      allowedNavPages?: unknown;
    } | null;

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const user = await createClientShareUser({
      fullName: String(body.fullName ?? ""),
      email: String(body.email ?? ""),
      password: String(body.password ?? ""),
      projectId: String(body.projectId ?? ""),
      allowedNavPages: body.allowedNavPages,
    });

    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    console.error("Failed to create client share user:", error);
    const message =
      error instanceof Error ? error.message : "Failed to create client share login";
    const status =
      message.includes("exists") || message.includes("required") || message.includes("Select")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
