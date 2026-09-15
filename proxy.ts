import { NextRequest, NextResponse } from "next/server";

const ADMIN_SESSION_COOKIE = "portal_admin_session";

/**
 * This app does not use Server Actions. Bots still POST with a `next-action`
 * header (often junk like "x"), which Next.js logs as a hard error. Reject
 * those requests early so they never hit the action handler.
 * https://nextjs.org/docs/messages/failed-to-find-server-action
 */
function isServerActionProbe(request: NextRequest) {
  return request.method === "POST" && request.headers.has("next-action");
}

export function proxy(request: NextRequest) {
  if (isServerActionProbe(request)) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const { pathname } = request.nextUrl;

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const isLoginPage = pathname === "/admin";
    const hasSession = Boolean(
      request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    );

    if (!isLoginPage && !hasSession) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }

    if (isLoginPage && hasSession) {
      return NextResponse.redirect(new URL("/admin/dashboard", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin",
    "/admin/:path*",
    {
      source: "/:path*",
      has: [{ type: "header", key: "next-action" }],
    },
  ],
};
