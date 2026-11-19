export type ParsedCalendarRsvpReply = {
  uid: string;
  attendeeEmail: string;
  partstat: string;
};

export function extractIcsBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    blocks.push(match[0]);
  }
  return blocks;
}

export function parseCalendarRsvpReply(icsText: string): ParsedCalendarRsvpReply | null {
  const text = String(icsText ?? "");
  if (!/METHOD\s*:\s*REPLY/i.test(text)) {
    return null;
  }

  const uid = /^UID:([^\r\n]+)/im.exec(text)?.[1]?.trim() ?? "";
  if (!uid) {
    return null;
  }

  const attendeeLine =
    /^ATTENDEE[^\r\n]*PARTSTAT=([^;\r\n]+)[^\r\n]*:mailto:([^\r\n]+)/im.exec(text) ??
    /^ATTENDEE[^\r\n]*:mailto:([^\r\n]+)/im.exec(text);

  let partstat = "";
  let attendeeEmail = "";

  if (attendeeLine) {
    if (attendeeLine.length >= 3 && attendeeLine[2]) {
      partstat = attendeeLine[1]?.trim() ?? "";
      attendeeEmail = attendeeLine[2]?.trim() ?? "";
    } else {
      attendeeEmail = attendeeLine[1]?.trim() ?? "";
      partstat = /PARTSTAT=([^;\r\n]+)/i.exec(attendeeLine[0])?.[1]?.trim() ?? "";
    }
  }

  if (!partstat) {
    partstat = /PARTSTAT=([^;\r\n]+)/i.exec(text)?.[1]?.trim() ?? "";
  }

  return {
    uid,
    attendeeEmail: attendeeEmail.replace(/^mailto:/i, "").trim(),
    partstat: partstat.toUpperCase(),
  };
}

export function isAcceptedCalendarRsvp(partstat: string) {
  const value = partstat.trim().toUpperCase();
  return value === "ACCEPTED" || value === "TENTATIVE";
}
