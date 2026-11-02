import {
  getOrCreateDeliverabilityInbox,
  getAgentMailMessage,
  getAgentMailRawMessage,
  isAgentMailConfigured,
  waitForAgentMailMessage,
  type AgentMailAuthResult,
  type AgentMailAuthenticationResults,
} from "@/lib/agentmail";
import {
  checkIpDnsbls,
  extractSendingIpFromRaw,
} from "@/lib/deliverability-dnsbl";
import { runPostmarkSpamCheck } from "@/lib/postmark-spamcheck";
import {
  getProjectSender,
  sendProjectTestEmail,
} from "@/lib/smtp-senders-server";
import {
  injectCampaignTracking,
  resolveUtmConfig,
  trackingOrigin,
} from "@/lib/campaign-tracking";
import { isGmailOrOutlookProvider } from "@/lib/smtp-senders";
import { ObjectId } from "mongodb";

export type DeliverabilityCheckStatus =
  | "success"
  | "warning"
  | "failure"
  | "neutral";

export type DeliverabilityCheckItem = {
  title: string;
  status: DeliverabilityCheckStatus;
  mark: number;
  description: string;
  detail?: string;
};

export type DeliverabilityReport = {
  score: number;
  rating: string;
  comment: string;
  inboxEmail: string;
  messageInfo: {
    subject: string;
    from: string;
    receivedAt: string;
    labels: string[];
  };
  spamAssassin: {
    rawScore: number;
    displayScore: number;
    rules: Array<{ name: string; score: number; description: string }>;
    error?: string;
  };
  authentication: {
    spf: DeliverabilityCheckItem;
    dkim: DeliverabilityCheckItem;
    dmarc: DeliverabilityCheckItem;
  };
  blacklists: {
    ip: string | null;
    listedCount: number;
    checks: Array<{
      label: string;
      zone: string;
      listed: boolean;
      detail?: string;
    }>;
  };
  content: DeliverabilityCheckItem[];
  checkedAt: string;
};

export type RunDeliverabilityTestInput = {
  projectId: string;
  senderId: string;
  subject: string;
  html: string;
  fromName?: string;
  replyTo?: string;
  campaignName?: string;
  utmEnabled?: boolean;
  utmSourceEnabled?: boolean;
  utmSource?: string;
  utmMediumEnabled?: boolean;
  utmMedium?: string;
  utmCampaignEnabled?: boolean;
  utmCampaign?: string;
  openTrackingOff?: boolean;
  clickTrackingOff?: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function ratingForScore(score: number) {
  if (score >= 9) return "Excellent";
  if (score >= 7) return "Good";
  if (score >= 5) return "Fair";
  if (score >= 3) return "Poor";
  return "Spam risk";
}

function commentForScore(score: number) {
  if (score >= 9) return "Looks great — strong chance of landing in the inbox.";
  if (score >= 7) return "Solid overall. Fix the warnings below to push it higher.";
  if (score >= 5) return "Mixed result. Authentication or content issues may hurt delivery.";
  if (score >= 3) return "High risk of spam or quarantine. Fix failures before blasting.";
  return "Very likely to be blocked or filtered as spam.";
}

function authStatus(result: AgentMailAuthResult | undefined): {
  status: DeliverabilityCheckStatus;
  mark: number;
  title: string;
} {
  switch (result) {
    case "pass":
      return { status: "success", mark: 0, title: "Passed" };
    case "softfail":
    case "neutral":
      return { status: "warning", mark: -0.5, title: result };
    case "fail":
      return { status: "failure", mark: -1, title: "Failed" };
    case "temperror":
    case "permerror":
      return { status: "warning", mark: -0.5, title: result };
    case "none":
      return { status: "warning", mark: -0.5, title: "None" };
    default:
      return { status: "neutral", mark: 0, title: "Not reported" };
  }
}

function buildAuthItem(
  name: string,
  result: AgentMailAuthResult | undefined,
  domain: string | undefined,
  failMark: number,
): DeliverabilityCheckItem {
  const base = authStatus(result);
  const mark =
    result === "fail" ? failMark : result === "softfail" ? -0.5 : base.mark;
  const domainBit = domain ? ` (${domain})` : "";
  return {
    title: `${name}: ${base.title}${domainBit}`,
    status: base.status,
    mark,
    description: `${name} authentication result from AgentMail.`,
    detail: result ? `Result: ${result}` : "AgentMail did not return a verdict for this check.",
  };
}

function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function analyzeContent(html: string, text: string): DeliverabilityCheckItem[] {
  const items: DeliverabilityCheckItem[] = [];
  const plain = text.trim() || htmlToText(html);
  const htmlLen = html.trim().length;
  const textLen = plain.length;
  const ratio = htmlLen > 0 ? textLen / htmlLen : 1;

  if (!plain) {
    items.push({
      title: "Missing plain-text part",
      status: "warning",
      mark: -0.5,
      description: "Emails with only HTML and little extractable text look more like spam.",
    });
  } else if (ratio < 0.1 && htmlLen > 400) {
    items.push({
      title: "Low text-to-HTML ratio",
      status: "warning",
      mark: -0.4,
      description: "Very little readable text compared to HTML markup.",
      detail: `Approx. ratio ${(ratio * 100).toFixed(1)}%`,
    });
  } else {
    items.push({
      title: "Text content looks fine",
      status: "success",
      mark: 0,
      description: "Readable text content was found in the message.",
    });
  }

  const images = html.match(/<img\b[^>]*>/gi) ?? [];
  const missingAlt = images.filter((tag) => !/\balt\s*=\s*["'][^"']+["']/i.test(tag));
  if (missingAlt.length > 0) {
    items.push({
      title: `${missingAlt.length} image${missingAlt.length === 1 ? "" : "s"} missing alt text`,
      status: "warning",
      mark: -0.3,
      description: "Images without alt attributes can hurt spam filters and accessibility.",
    });
  } else if (images.length > 0) {
    items.push({
      title: "Image alt attributes present",
      status: "success",
      mark: 0,
      description: "All images include alt text.",
    });
  }

  const shortLinks =
    html.match(/https?:\/\/(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly)\/[^\s"'<>]+/gi) ??
    [];
  if (shortLinks.length > 0) {
    items.push({
      title: "URL shortener detected",
      status: "warning",
      mark: -0.5,
      description: "Shortened links are a common spam signal.",
      detail: shortLinks.slice(0, 3).join(", "),
    });
  }

  if (/javascript:/i.test(html) || /<script\b/i.test(html)) {
    items.push({
      title: "Script / javascript: link found",
      status: "failure",
      mark: -1,
      description: "Scripts and javascript: URLs are strongly associated with spam/phishing.",
    });
  }

  return items;
}

function uniqueMarker() {
  return `nxs-d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function runDeliverabilityTest(
  input: RunDeliverabilityTestInput,
): Promise<DeliverabilityReport> {
  if (!isAgentMailConfigured()) {
    throw new Error(
      "AgentMail is not configured. Add AGENTMAIL_API_KEY to the server env.",
    );
  }
  if (!ObjectId.isValid(input.projectId) || !ObjectId.isValid(input.senderId)) {
    throw new Error("Invalid project or sender.");
  }
  if (!input.html.trim()) {
    throw new Error("Email HTML is empty.");
  }

  const projectId = new ObjectId(input.projectId);
  const sender = await getProjectSender(projectId, new ObjectId(input.senderId));
  if (!sender) {
    throw new Error("Sender not found.");
  }

  const marker = uniqueMarker();
  // Reuse one inbox — free AgentMail plans only allow a few inboxes.
  const inbox = await getOrCreateDeliverabilityInbox();
  const afterIso = new Date(Date.now() - 5_000).toISOString();
  const subjectBase = input.subject.trim() || "(no subject)";
  const subject = `${subjectBase} [${marker}]`;

  const html = injectCampaignTracking(
    input.html,
    trackingOrigin(sender.trackingDomain),
    `deliverability-${Date.now()}`,
    {
      utm: resolveUtmConfig(input),
      campaignName: input.campaignName ?? "",
      trackOpens: input.openTrackingOff !== true,
      trackClicks: input.clickTrackingOff !== true,
      autoUnsubscribeFooter: !isGmailOrOutlookProvider(sender.provider),
    },
  );

  await sendProjectTestEmail(projectId, {
    senderId: input.senderId,
    to: [inbox.email],
    subject,
    html,
    fromName: input.fromName,
    replyTo: input.replyTo,
  });

  const listed = await waitForAgentMailMessage({
    inboxId: inbox.inbox_id,
    afterIso,
    subjectMarker: marker,
    timeoutMs: 60_000,
    pollMs: 2_000,
  });

  const [message, rawPayload] = await Promise.all([
    getAgentMailMessage(inbox.inbox_id, listed.message_id),
    getAgentMailRawMessage(inbox.inbox_id, listed.message_id),
  ]);

  const [spamResult, dnsbl] = await Promise.all([
    runPostmarkSpamCheck(rawPayload.raw)
      .then((spam) => ({ spam, error: null as string | null }))
      .catch((error) => ({
        spam: null,
        error:
          error instanceof Error
            ? error.message
            : "Postmark SpamAssassin check failed",
      })),
    (async () => {
      const ip = extractSendingIpFromRaw(rawPayload.raw);
      if (!ip) {
        return { ip: null as string | null, checks: [], listedCount: 0 };
      }
      const result = await checkIpDnsbls(ip);
      return {
        ip: result.ip,
        checks: result.checks,
        listedCount: result.listedCount,
      };
    })(),
  ]);

  const auth = message.authentication_results ?? listed.authentication_results ?? {};
  const authentication = buildAuthentication(auth);
  const content = analyzeContent(message.html ?? html, message.text ?? "");

  // If SpamAssassin is unavailable, start from a neutral 7 so auth/content
  // penalties still produce a useful overall mark.
  const saDisplay = spamResult.spam
    ? round1(clamp(10 - spamResult.spam.score, 0, 10))
    : 7;
  let score = saDisplay;
  score += authentication.spf.mark;
  score += authentication.dkim.mark;
  score += authentication.dmarc.mark;
  score += Math.max(-3, dnsbl.listedCount * -1.5);
  for (const item of content) {
    score += item.mark;
  }
  score = round1(clamp(score, 0, 10));

  return {
    score,
    rating: ratingForScore(score),
    comment: spamResult.error
      ? `SpamAssassin unavailable (${spamResult.error}). Score uses auth, blacklist, and content only.`
      : commentForScore(score),
    inboxEmail: inbox.email,
    messageInfo: {
      subject: message.subject ?? subject,
      from: message.from,
      receivedAt: message.created_at || message.timestamp,
      labels: message.labels ?? [],
    },
    spamAssassin: {
      rawScore: spamResult.spam?.score ?? 0,
      displayScore: saDisplay,
      rules: (spamResult.spam?.rules ?? [])
        .filter((rule) => rule.score !== 0 || rule.name)
        .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
        .slice(0, 40),
      ...(spamResult.error ? { error: spamResult.error } : {}),
    },
    authentication,
    blacklists: dnsbl,
    content,
    checkedAt: new Date().toISOString(),
  };
}

function buildAuthentication(auth: AgentMailAuthenticationResults) {
  return {
    spf: buildAuthItem("SPF", auth.spf, auth.spf_domain, -1),
    dkim: buildAuthItem("DKIM", auth.dkim, auth.dkim_domain, -1),
    dmarc: buildAuthItem("DMARC", auth.dmarc, auth.dmarc_domain, -1.5),
  };
}
