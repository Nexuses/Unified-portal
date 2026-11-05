import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  listProjectAssistantIntegrations,
  upsertProjectAssistantIntegration,
} from "@/lib/project-assistant-server";
import type { ProjectAssistantAuthType } from "@/lib/project-assistant-types";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export async function GET() {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }
    const integrations = await listProjectAssistantIntegrations(
      new ObjectId(session.projectId),
    );
    return NextResponse.json(
      { integrations },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Project assistant integrations list failed:", error);
    return NextResponse.json(
      { error: "Failed to load connected tools" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }
    const body = (await request.json().catch(() => null)) as {
      provider?: string;
      name?: string;
      apiKey?: string;
      baseUrl?: string;
      authType?: ProjectAssistantAuthType;
    } | null;
    const integration = await upsertProjectAssistantIntegration({
      projectId: new ObjectId(session.projectId),
      provider: String(body?.provider || ""),
      name: body?.name,
      apiKey: String(body?.apiKey || ""),
      baseUrl: body?.baseUrl,
      authType: body?.authType,
    });
    return NextResponse.json({ integration });
  } catch (error) {
    console.error("Project assistant connect failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to connect tool",
      },
      { status: 400 },
    );
  }
}
