export type EdmResult = { message: string; html: string };

function decodeJsonString(value: string) {
  return value.replace(/\\(?:u([0-9a-fA-F]{4})|["\\/bfnrt])/g, (full, hex: string) => {
    if (hex) return String.fromCharCode(Number.parseInt(hex, 16));
    switch (full[1]) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "b":
        return "\b";
      case "f":
        return "\f";
      case '"':
        return '"';
      case "/":
        return "/";
      case "\\":
        return "\\";
      default:
        return full;
    }
  });
}

function readJsonStringField(raw: string, field: string) {
  const match = new RegExp(`"${field}"\\s*:\\s*"`).exec(raw);
  if (!match || match.index === undefined) return "";
  let index = match.index + match[0].length;
  let encoded = "";
  while (index < raw.length) {
    const char = raw[index];
    if (char === "\\") {
      encoded += char + (raw[index + 1] ?? "");
      index += 2;
      continue;
    }
    if (char === '"') break;
    encoded += char;
    index += 1;
  }
  return decodeJsonString(encoded).trim();
}

function cleanMessage(value: string) {
  const trimmed = value.replace(/^["'\s]+|["'\s,]+$/g, "").trim();
  if (
    !trimmed ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("<!DOCTYPE") ||
    trimmed.startsWith("<html") ||
    trimmed.startsWith("<")
  ) {
    return "Here is the email.";
  }
  return trimmed.slice(0, 400);
}

function htmlFrom(value: string) {
  const text = value.trim();
  const complete =
    text.match(/<!DOCTYPE html[\s\S]*<\/html>/i) ?? text.match(/<html[\s\S]*<\/html>/i);
  if (complete) return complete[0].trim();
  const partial = text.match(/<!DOCTYPE html[\s\S]*/i) ?? text.match(/<html[\s\S]*/i);
  return partial?.[0].trim() ?? "";
}

export function extractEdmResult(raw: string): EdmResult {
  const text = raw.replace(/```(?:json|html)?/gi, "").trim();

  const marked = text.match(/MESSAGE:\s*([\s\S]*?)\n\s*HTML:\s*([\s\S]*)/i);
  if (marked) {
    const html = htmlFrom(marked[2]) || marked[2].trim();
    if (html) return { message: cleanMessage(marked[1]), html };
  }

  const htmlField = readJsonStringField(text, "html");
  if (htmlField) {
    return {
      message: cleanMessage(readJsonStringField(text, "message")),
      html: htmlFrom(htmlField) || htmlField,
    };
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as {
        message?: unknown;
        html?: unknown;
      };
      if (typeof parsed.html === "string" && parsed.html.trim()) {
        return {
          message: cleanMessage(typeof parsed.message === "string" ? parsed.message : ""),
          html: htmlFrom(parsed.html) || parsed.html.trim(),
        };
      }
    } catch {
      // The field reader above already covers broken JSON.
    }
  }

  const html = htmlFrom(text);
  if (html) return { message: "Here is the email.", html };

  return { message: cleanMessage(text.slice(0, 500)), html: "" };
}

export function htmlIsComplete(html: string) {
  return /<\/html>\s*$/i.test(html.trim());
}
