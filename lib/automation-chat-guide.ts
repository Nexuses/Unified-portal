/** Guided automation setup steps driven from the chat sidebar. */

export type GuideStepId =
  | "idle"
  | "start"
  | "past_select"
  | "past_freq"
  | "type"
  | "sender"
  | "recipients"
  | "subject"
  | "design"
  | "fu_ask"
  | "fu_type"
  | "fu_freq"
  | "fu_gap"
  | "fu_subject"
  | "fu_design"
  | "done";

export type ChatChoice = {
  id: string;
  label: string;
  description?: string;
};

export type GuidedChatTurn = {
  role: "user" | "assistant";
  content: string;
  choices?: ChatChoice[];
  /** When set, choices are locked after a pick. */
  selectedChoiceId?: string;
  guideStep?: GuideStepId;
};

export type GuideSession = {
  active: boolean;
  step: GuideStepId;
  /** Waiting for free-text (subject / pasted HTML / custom gap). */
  awaitingText?: "subject" | "html" | "fu_subject" | "fu_html" | "fu_gap_custom";
  emailIndex: number;
};

export const GUIDE_TEMPLATES: Record<
  string,
  { label: string; subject: string; html: string }
> = {
  welcome: {
    label: "Welcome email",
    subject: "Welcome — glad you're here",
    html: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
<p>Hi {{ contact.FIRSTNAME }},</p>
<p>Thanks for joining us. Here's a quick hello and what to expect next.</p>
<p>If you have questions, just reply to this email.</p>
<p>— The team</p>
<p style="font-size:12px;color:#6b7280"><a href="{{ unsubscribe }}">Unsubscribe</a></p>
</div>`,
  },
  followup: {
    label: "Friendly follow-up",
    subject: "Quick follow-up",
    html: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
<p>Hi {{ contact.FIRSTNAME }},</p>
<p>Just bumping this in case it got buried. Happy to help if you have any questions.</p>
<p>— The team</p>
<p style="font-size:12px;color:#6b7280"><a href="{{ unsubscribe }}">Unsubscribe</a></p>
</div>`,
  },
  offer: {
    label: "Offer / update",
    subject: "Something useful for you",
    html: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
<p>Hi {{ contact.FIRSTNAME }},</p>
<p>We put together a short update we think you'll find useful. Take a look when you have a minute.</p>
<p>— The team</p>
<p style="font-size:12px;color:#6b7280"><a href="{{ unsubscribe }}">Unsubscribe</a></p>
</div>`,
  },
};

export function newGuideSession(): GuideSession {
  return { active: false, step: "idle", emailIndex: 0 };
}

export function startGuideChoices(): ChatChoice[] {
  return [
    { id: "past", label: "Past campaign", description: "Email engagers from a sent campaign" },
    { id: "new", label: "New campaign", description: "Fresh list + sender + design" },
  ];
}

export function engagementChoices(): ChatChoice[] {
  return [
    { id: "opens", label: "Opened" },
    { id: "clicks", label: "Clicked" },
    { id: "opens_or_clicks", label: "Opened or clicked" },
  ];
}

export function typeChoices(): ChatChoice[] {
  return [
    { id: "drip", label: "Drip", description: "One email to a list" },
    { id: "oneone", label: "1-1", description: "Personal sequence" },
  ];
}

export function gapChoices(): ChatChoice[] {
  return [
    { id: "1", label: "1 day" },
    { id: "2", label: "2 days" },
    { id: "3", label: "3 days" },
    { id: "7", label: "7 days" },
    { id: "custom", label: "Custom…", description: "Type a number of days" },
  ];
}

export function designChoices(): ChatChoice[] {
  return [
    { id: "tpl:welcome", label: GUIDE_TEMPLATES.welcome.label },
    { id: "tpl:followup", label: GUIDE_TEMPLATES.followup.label },
    { id: "tpl:offer", label: GUIDE_TEMPLATES.offer.label },
    { id: "paste", label: "Paste HTML next", description: "Send HTML in your next message" },
    { id: "editor", label: "Open design editor", description: "Finish design in the setup panel" },
  ];
}

export function subjectQuickChoices(): ChatChoice[] {
  return [
    { id: "sub:welcome", label: GUIDE_TEMPLATES.welcome.subject },
    { id: "sub:followup", label: GUIDE_TEMPLATES.followup.subject },
    { id: "sub:offer", label: GUIDE_TEMPLATES.offer.subject },
    { id: "sub:type", label: "I'll type my own" },
  ];
}

export function afterEmailChoices(): ChatChoice[] {
  return [
    { id: "add_fu", label: "Add next email" },
    { id: "done", label: "Done for now" },
  ];
}

export function isGuideStartMessage(text: string) {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) {
    return false;
  }
  // Exact / short intents
  if (
    t === "set up this campaign" ||
    t === "setup this campaign" ||
    t === "set up campaign" ||
    t === "setup campaign" ||
    t === "set up automation" ||
    t === "setup automation" ||
    t === "setup automation campaign" ||
    t === "set up automation campaign" ||
    t === "help me set up" ||
    t === "guide me" ||
    t === "start setup" ||
    t === "start guided setup"
  ) {
    return true;
  }
  // Broader phrasing: "setup automation campaign", "help me setup the flow", etc.
  const wantsSetup =
    /\b(set\s*up|setup|configure|build)\b/.test(t) &&
    /\b(campaign|automation|flow|email)\b/.test(t);
  const wantsGuide =
    /\b(walk me|guide me|help me|step by step|step-by-step)\b/.test(t) &&
    /\b(setup|set up|campaign|automation)\b/.test(t);
  return wantsSetup || wantsGuide || t.startsWith("set up this") || t.startsWith("setup this");
}
