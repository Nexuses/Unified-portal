import { NextResponse } from "next/server";
import { getPublicContactByShareToken } from "@/lib/crm-contacts-server";
import { getProjectBranding } from "@/lib/project-branding";

type RouteContext = {
  params: Promise<{ token: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    const found = await getPublicContactByShareToken(token);
    if (!found) {
      return NextResponse.json({ error: "Lead report not found" }, { status: 404 });
    }

    const branding = await getProjectBranding(found.projectId);

    return NextResponse.json(
      {
        contact: found.contact,
        branding: {
          name: branding.name,
          logoUrl: branding.logoUrl
            ? `/api/public/leads/${encodeURIComponent(token)}/project-logo`
            : "",
        },
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    console.error("Failed to load public lead report:", error);
    return NextResponse.json(
      { error: "Failed to load lead report" },
      { status: 500 },
    );
  }
}
