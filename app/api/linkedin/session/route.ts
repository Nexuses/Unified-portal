import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import {
  captureLinkedinAccountPhoto,
  confirmLinkedinLogin,
  disconnectLinkedinLogin,
  getLinkedinComputerStatus,
  getLinkedinSession,
  getLinkedinVpnSetting,
  openLinkedinComputer,
  releaseLinkedinComputer,
  setLinkedinVpnEnabled,
  startLinkedinComputerOnly,
  watchLinkedinComputer,
} from "@/lib/linkedin-campaigns-server";
import { isSessionError, requirePortalSession } from "@/lib/require-portal-session";

export async function GET(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const projectId = new ObjectId(session.projectId);
    if (request.nextUrl.searchParams.get("vpn") === "1") {
      return NextResponse.json({ vpn: await getLinkedinVpnSetting(projectId) });
    }
    if (request.nextUrl.searchParams.get("computer") === "1") {
      const withDesktop = request.nextUrl.searchParams.get("desktop") === "1";
      return NextResponse.json({
        computer: await getLinkedinComputerStatus(projectId, { withDesktop }),
      });
    }
    const linkedin = await getLinkedinSession(projectId);
    return NextResponse.json({ session: linkedin });
  } catch (error) {
    console.error("LinkedIn session failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load LinkedIn" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) return session;
    const projectId = new ObjectId(session.projectId);
    const body = (await request.json().catch(() => null)) as {
      action?: string;
      accountName?: string;
      withDesktop?: boolean;
    } | null;
    if (body?.action === "computer_status") {
      return NextResponse.json({
        computer: await getLinkedinComputerStatus(projectId, {
          withDesktop: body.withDesktop === true,
        }),
      });
    }
    if (body?.action === "start_computer") {
      const started = await startLinkedinComputerOnly(projectId);
      return NextResponse.json(started);
    }
    if (body?.action === "release_computer" || body?.action === "stop_computer") {
      const released = await releaseLinkedinComputer(projectId);
      return NextResponse.json(released);
    }
    if (body?.action === "vpn_status") {
      return NextResponse.json({ vpn: await getLinkedinVpnSetting(projectId) });
    }
    if (body?.action === "vpn_enable" || body?.action === "vpn_disable") {
      const enabled = body.action === "vpn_enable";
      try {
        const vpn = await setLinkedinVpnEnabled(projectId, enabled, session.email);
        return NextResponse.json({
          vpn,
          computer: await getLinkedinComputerStatus(projectId),
        });
      } catch (error) {
        return NextResponse.json(
          {
            error: error instanceof Error ? error.message : "Could not update VPN",
            vpn: await getLinkedinVpnSetting(projectId),
            computer: await getLinkedinComputerStatus(projectId).catch(() => null),
          },
          { status: 502 },
        );
      }
    }
    if (body?.action === "photo") {
      const linkedin = await captureLinkedinAccountPhoto(projectId);
      return NextResponse.json({ session: linkedin });
    }
    if (body?.action === "disconnect") {
      const linkedin = await disconnectLinkedinLogin(projectId);
      return NextResponse.json({ session: linkedin });
    }
    if (body?.action === "confirm") {
      const linkedin = await confirmLinkedinLogin(projectId, String(body.accountName || ""));
      return NextResponse.json({ session: linkedin });
    }
    if (body?.action === "watch") {
      const opened = await watchLinkedinComputer(projectId);
      return NextResponse.json({ desktopUrl: opened.desktopUrl });
    }
    const opened = await openLinkedinComputer(projectId);
    return NextResponse.json({
      desktopUrl: opened.desktopUrl,
      session: opened.session,
      vpn: await getLinkedinVpnSetting(projectId),
      computer: await getLinkedinComputerStatus(projectId),
    });
  } catch (error) {
    console.error("LinkedIn computer failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not open LinkedIn" },
      { status: 400 },
    );
  }
}
