import { NextResponse } from "next/server";
import { getSessionAdmin } from "@/lib/auth";

export async function GET() {
  try {
    const admin = await getSessionAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    return NextResponse.json(admin);
  } catch (error) {
    console.error("Failed to fetch admin session:", error);
    return NextResponse.json(
      { error: "Failed to fetch session" },
      { status: 500 },
    );
  }
}
