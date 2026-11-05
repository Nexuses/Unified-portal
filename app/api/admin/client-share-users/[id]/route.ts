import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  deleteClientShareUser,
  updateClientShareUser,
} from "@/lib/client-share-users-server";
import {
  isAdminSessionError,
  requireAdminSession,
} from "@/lib/require-admin-session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const admin = await requireAdminSession();
    if (isAdminSessionError(admin)) {
      return admin;
    }

    const { id } = await context.params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
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

    const user = await updateClientShareUser(new ObjectId(id), {
      fullName: String(body.fullName ?? ""),
      email: String(body.email ?? ""),
      password: body.password ? String(body.password) : undefined,
      projectId: String(body.projectId ?? ""),
      allowedNavPages: body.allowedNavPages,
    });

    if (!user) {
      return NextResponse.json({ error: "Client share login not found" }, { status: 404 });
    }

    return NextResponse.json(user);
  } catch (error) {
    console.error("Failed to update client share user:", error);
    const message =
      error instanceof Error ? error.message : "Failed to update client share login";
    const status =
      message.includes("exists") || message.includes("required") || message.includes("Select")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const admin = await requireAdminSession();
    if (isAdminSessionError(admin)) {
      return admin;
    }

    const { id } = await context.params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    }

    const deleted = await deleteClientShareUser(new ObjectId(id));
    if (!deleted) {
      return NextResponse.json({ error: "Client share login not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete client share user:", error);
    return NextResponse.json(
      { error: "Failed to delete client share login" },
      { status: 500 },
    );
  }
}
