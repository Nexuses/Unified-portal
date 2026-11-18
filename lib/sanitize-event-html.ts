import DOMPurify from "isomorphic-dompurify";

const ALLOWED_TAGS = [
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "br",
  "p",
  "div",
  "span",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "ul",
  "ol",
  "li",
  "a",
  "blockquote",
  "img",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "pre",
  "code",
  "sub",
  "sup",
];

const ALLOWED_ATTR = [
  "href",
  "target",
  "rel",
  "src",
  "alt",
  "width",
  "height",
  "style",
  "class",
  "colspan",
  "rowspan",
  "align",
];

/** Sanitize rich HTML for the About Event section (forms + public page). */
export function sanitizeEventHtml(input: string): string {
  return DOMPurify.sanitize(String(input ?? ""), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|data:image\/|#)/i,
  });
}
