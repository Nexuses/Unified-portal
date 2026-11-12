/** Stable Notion-like select token colors from a string key. */

export type NotionSelectColor = {
  id: string;
  background: string;
  color: string;
};

const PALETTE: NotionSelectColor[] = [
  { id: "gray", background: "rgba(227,226,224,.9)", color: "#37352f" },
  { id: "brown", background: "rgba(238,224,218,.95)", color: "#64473a" },
  { id: "orange", background: "rgba(250,222,201,.95)", color: "#d9730d" },
  { id: "yellow", background: "rgba(249,236,195,.95)", color: "#cb912f" },
  { id: "green", background: "rgba(219,237,219,.95)", color: "#448361" },
  { id: "blue", background: "rgba(211,229,239,.95)", color: "#337ea9" },
  { id: "purple", background: "rgba(232,222,238,.95)", color: "#9065b0" },
  { id: "pink", background: "rgba(245,224,233,.95)", color: "#c14c8a" },
  { id: "red", background: "rgba(255,226,221,.95)", color: "#d44c47" },
  { id: "teal", background: "rgba(210,240,236,.95)", color: "#0f7b6c" },
];

function hashKey(value: string) {
  let hash = 0;
  const text = value.trim().toLowerCase();
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function notionSelectColor(value: string): NotionSelectColor {
  if (!value.trim()) {
    return PALETTE[0];
  }
  return PALETTE[hashKey(value) % PALETTE.length];
}
