import { NextRequest, NextResponse } from "next/server";
import { recordSesBounce } from "@/lib/campaign-blasts-server";
import {
  confirmSnsSubscription,
  parseSesBounce,
  verifySnsMessage,
  type SnsEnvelope,
} from "@/lib/ses-sns";

export const runtime = "nodejs";

/**
 * Amazon SNS endpoint for SES bounce events.
 * Subscribe the configuration-set topic to:
 * https://unified.nexuses.xyz/api/webhooks/ses
 */
export async function POST(request: NextRequest) {
  let envelope: SnsEnvelope;
  try {
    envelope = JSON.parse(await request.text()) as SnsEnvelope;
  } catch {
    return NextResponse.json({ error: "Invalid SNS message" }, { status: 400 });
  }

  try {
    const valid = await verifySnsMessage(envelope);
    if (!valid) {
      return NextResponse.json({ error: "Invalid SNS signature" }, { status: 403 });
    }
  } catch (error) {
    console.error("SES SNS signature check failed:", error);
    return NextResponse.json({ error: "Could not verify SNS message" }, { status: 500 });
  }

  const type = String(envelope.Type ?? "");

  if (type === "SubscriptionConfirmation") {
    try {
      await confirmSnsSubscription(String(envelope.SubscribeURL ?? ""));
      return NextResponse.json({ ok: true, confirmed: true });
    } catch (error) {
      console.error("SES SNS confirm failed:", error);
      return NextResponse.json(
        { error: "Could not confirm SNS subscription" },
        { status: 500 },
      );
    }
  }

  if (type !== "Notification") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  let event: unknown;
  try {
    event =
      typeof envelope.Message === "string"
        ? JSON.parse(envelope.Message)
        : envelope.Message;
  } catch {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const bounce = parseSesBounce(event);
  if (!bounce) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    const result = await recordSesBounce(bounce);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Failed to record SES bounce:", error);
    return NextResponse.json({ error: "Could not record bounce" }, { status: 500 });
  }
}
