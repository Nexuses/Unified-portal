import { NextResponse } from "next/server";

/**
 * Landing page for the hidden email click honeypot.
 * Scanners that open every link land here; humans almost never do.
 */
export function GET() {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><title></title></head><body></body></html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}
