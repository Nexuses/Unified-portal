import { NextRequest, NextResponse } from "next/server";

const ADMIN_SESSION_COOKIE = "portal_admin_session";

export function middleware(request: NextRequest) {
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
  matcher: ["/admin", "/admin/:path*"],
};
