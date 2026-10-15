export const KNOWLEDGE_MAX_FILE_BYTES = 20 * 1024 * 1024;

export const KNOWLEDGE_ACCEPT =
  ".pdf,.docx,.pptx,.xlsx,.csv,.tsv,.txt,.md,.markdown,.html,.htm,.json";

export function knowledgeNameFromFileName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export type KnowledgeDoc = {
  id: string;
  title: string;
  fileName: string;
  fileType: string;
  /** Size of the original upload in bytes (the file itself is not kept). */
  fileSize: number;
  /** Size of the stored Markdown in characters. */
  markdownChars: number;
  truncated: boolean;
  /** First lines of the content as plain text. */
  preview: string;
  createdAt: string;
  createdBy: string;
};

export type KnowledgeDocWithMarkdown = KnowledgeDoc & { markdown: string };

export type KnowledgeUploadResult =
  | { fileName: string; ok: true; doc: KnowledgeDoc }
  | { fileName: string; ok: false; error: string };
