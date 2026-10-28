import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { CampaignBlastDoc } from "@/lib/campaign-blasts-server";
import type { SmtpProviderId } from "@/lib/smtp-senders";
import { getProjectSenders } from "@/lib/smtp-senders-server";

export type SenderEmailHealth = {
  id: string;
  fromEmail: string;
  fromName: string;
  provider: string;
  providerId: SmtpProviderId | null;
  sent: number;
  opens: number;
  clicks: number;
  replies: number;
  bounces: number;
  replyRate: number;
  bounceRate: number;
  status: "good" | "fair" | "watch";
};

export type ProjectEmailHealth = {
  senders: SenderEmailHealth[];
  totals: {
    sent: number;
    opens: number;
    clicks: number;
    replies: number;
    bounces: number;
  };
};

type BlastHealthAgg = {
  _id: string;
  sent: number;
  opens: number;
  clicks: number;
  replies: number;
  bounces: number;
  senderName?: string;
};

function rate(part: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function healthStatus(bounceRate: number, sent: number): SenderEmailHealth["status"] {
  if (sent <= 0) return "fair";
  if (bounceRate >= 5) return "watch";
  if (bounceRate >= 2) return "fair";
  return "good";
}

/** Per-sender outbound health from campaign blast rollups. */
export async function getProjectEmailHealth(
  projectId: ObjectId,
): Promise<ProjectEmailHealth> {
  const [senders, db] = await Promise.all([
    getProjectSenders(projectId),
    getDb(),
  ]);

  const rows = (await db
    .collection<CampaignBlastDoc>("campaign_blasts")
    .aggregate<BlastHealthAgg>([
      { $match: { projectId } },
      {
        $group: {
          _id: { $toLower: { $ifNull: ["$senderEmail", ""] } },
          sent: { $sum: { $ifNull: ["$delivered", 0] } },
          opens: { $sum: { $ifNull: ["$opens", 0] } },
          clicks: { $sum: { $ifNull: ["$clicks", 0] } },
          replies: { $sum: { $ifNull: ["$replies", 0] } },
          bounces: { $sum: { $ifNull: ["$bounces", 0] } },
          senderName: { $last: "$senderName" },
        },
      },
    ])
    .toArray()).filter((row) => row._id);

  const byEmail = new Map(rows.map((row) => [row._id, row]));

  const senderRows: SenderEmailHealth[] = senders.map((sender) => {
    const key = sender.fromEmail.trim().toLowerCase();
    const stats = byEmail.get(key);
    const sent = stats?.sent ?? 0;
    const opens = stats?.opens ?? 0;
    const clicks = stats?.clicks ?? 0;
    const replies = stats?.replies ?? 0;
    const bounces = stats?.bounces ?? 0;
    const replyRate = rate(replies, sent);
    const bounceRate = rate(bounces, sent);
    byEmail.delete(key);
    return {
      id: sender.id,
      fromEmail: sender.fromEmail,
      fromName: sender.fromEmail.split("@")[0] || sender.fromEmail,
      provider: sender.providerName || sender.provider,
      providerId: sender.provider,
      sent,
      opens,
      clicks,
      replies,
      bounces,
      replyRate,
      bounceRate,
      status: healthStatus(bounceRate, sent),
    };
  });

  // Campaigns that used an address no longer in SMTP still show for visibility.
  for (const [email, stats] of byEmail) {
    if (!email) continue;
    const sent = stats.sent ?? 0;
    const opens = stats.opens ?? 0;
    const clicks = stats.clicks ?? 0;
    const replies = stats.replies ?? 0;
    const bounces = stats.bounces ?? 0;
    const replyRate = rate(replies, sent);
    const bounceRate = rate(bounces, sent);
    senderRows.push({
      id: `legacy:${email}`,
      fromEmail: email,
      fromName: stats.senderName?.trim() || email.split("@")[0] || email,
      provider: "Campaign sender",
      providerId: null,
      sent,
      opens,
      clicks,
      replies,
      bounces,
      replyRate,
      bounceRate,
      status: healthStatus(bounceRate, sent),
    });
  }

  senderRows.sort((a, b) => b.sent - a.sent || a.fromEmail.localeCompare(b.fromEmail));

  const totals = senderRows.reduce(
    (acc, row) => {
      acc.sent += row.sent;
      acc.opens += row.opens;
      acc.clicks += row.clicks;
      acc.replies += row.replies;
      acc.bounces += row.bounces;
      return acc;
    },
    { sent: 0, opens: 0, clicks: 0, replies: 0, bounces: 0 },
  );

  return { senders: senderRows, totals };
}
