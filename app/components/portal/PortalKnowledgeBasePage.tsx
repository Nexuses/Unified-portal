"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import PortalToast from "@/app/components/portal/PortalToast";
import {
  KNOWLEDGE_ACCEPT,
  knowledgeNameFromFileName,
  KNOWLEDGE_MAX_FILE_BYTES,
  type KnowledgeDoc,
  type KnowledgeDocWithMarkdown,
  type KnowledgeUploadResult,
} from "@/lib/knowledge-base";

type QueueItem = {
  key: string;
  name: string;
  size: number;
  state: "waiting" | "converting" | "done" | "error";
  error?: string;
};

type PendingFile = { key: string; file: File; name: string };

type Toast = { key: number; message: string; variant: "error" | "success" };

const markdownComponents: Components = {
  table: ({ children }) => (
    <div className="pa-table-wrap">
      <table>{children}</table>
    </div>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function PortalKnowledgeBasePage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [showNameErrors, setShowNameErrors] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState<KnowledgeDocWithMarkdown | null>(null);
  const [viewLoadingId, setViewLoadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [project, setProject] = useState<{ name: string; logoUrl: string } | null>(null);

  const showToast = useCallback((message: string, variant: Toast["variant"] = "error") => {
    setToast({ key: Date.now(), message, variant });
  }, []);

  const loadDocs = useCallback(async () => {
    try {
      const response = await fetch("/api/knowledge-base", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load knowledge base");
      setDocs(data.docs as KnowledgeDoc[]);
      if (data.project) setProject(data.project as { name: string; logoUrl: string });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load knowledge base");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDocs();
  }, [loadDocs]);

  function updateQueue(key: string, patch: Partial<QueueItem>) {
    setQueue((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function stageFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0 || uploading) return;
    const stamp = Date.now();
    setQueue([]);
    setShowNameErrors(false);
    setPending((current) => [
      ...current,
      ...files.map((file, index) => ({
        key: `${stamp}-${index}`,
        file,
        name: knowledgeNameFromFileName(file.name),
      })),
    ]);
  }

  function startUpload() {
    if (pending.length === 0 || uploading) return;
    if (pending.some((item) => !item.name.trim())) {
      setShowNameErrors(true);
      return;
    }
    const batch = pending;
    setPending([]);
    setShowNameErrors(false);
    void uploadFiles(batch);
  }

  async function uploadFiles(batch: PendingFile[]) {
    const files = batch.map((item) => item.file);
    if (files.length === 0 || uploading) return;
    const items: QueueItem[] = batch.map(({ file, name }, index) => ({
      key: `${Date.now()}-${index}`,
      name: name.trim() || file.name,
      size: file.size,
      state: file.size > KNOWLEDGE_MAX_FILE_BYTES ? "error" : "waiting",
      error: file.size > KNOWLEDGE_MAX_FILE_BYTES ? "File is larger than 20 MB." : undefined,
    }));
    setQueue(items);
    setUploading(true);

    let added = 0;
    for (const [index, file] of files.entries()) {
      const item = items[index];
      if (item.state === "error") continue;
      updateQueue(item.key, { state: "converting" });
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("name", batch[index].name.trim());
        const response = await fetch("/api/knowledge-base", { method: "POST", body: form });
        const data = (await response.json().catch(() => ({}))) as {
          results?: KnowledgeUploadResult[];
          error?: string;
        };
        const result = data.results?.[0];
        if (result?.ok) {
          added += 1;
          setDocs((current) => [result.doc, ...current]);
          updateQueue(item.key, { state: "done" });
        } else {
          updateQueue(item.key, {
            state: "error",
            error: (result && !result.ok ? result.error : data.error) || "Could not convert this file.",
          });
        }
      } catch {
        updateQueue(item.key, { state: "error", error: "Upload failed. Check your connection." });
      }
    }

    setUploading(false);
    if (added > 0) {
      showToast(
        `${added} file${added === 1 ? "" : "s"} added to the knowledge base`,
        "success",
      );
    }
  }

  async function openDoc(id: string) {
    setViewLoadingId(id);
    try {
      const response = await fetch(`/api/knowledge-base/${id}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not open this document");
      setViewing(data.doc as KnowledgeDocWithMarkdown);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not open this document");
    } finally {
      setViewLoadingId(null);
    }
  }

  async function deleteDoc(doc: KnowledgeDoc) {
    if (!window.confirm(`Remove “${doc.title}” from the knowledge base?`)) return;
    setDeletingId(doc.id);
    try {
      const response = await fetch(`/api/knowledge-base/${doc.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete this document");
      setDocs((current) => current.filter((row) => row.id !== doc.id));
      if (viewing?.id === doc.id) setViewing(null);
      showToast(`Removed “${doc.title}”`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not delete this document");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="kb-page">
      <div className="crm-page-head">
        <div>
          <h2>Knowledge Base</h2>
          <p className="desc">
            Upload your project&apos;s documents once. Each file is converted to Markdown and used
            as context by AI tools like the EDM generator.
          </p>
        </div>
        {docs.length > 0 ? (
          <div className="kb-stats">
            <strong>{docs.length.toLocaleString()}</strong> document{docs.length === 1 ? "" : "s"}
          </div>
        ) : null}
      </div>

      <section className="kb-brand" aria-label="Client logo">
        <div className="kb-brand-logo">
          {project?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={project.logoUrl} alt={`${project.name} logo`} />
          ) : (
            <span>{project?.name?.slice(0, 1).toUpperCase() || "C"}</span>
          )}
        </div>
        <div className="kb-brand-text">
          <span className="kb-brand-label">Client logo</span>
          <strong>{project?.name || "This project"}</strong>
          <p>
            {project?.logoUrl
              ? "Used as the logo in EDM emails, social posts and other AI-generated content."
              : "No logo set yet. Ask your admin to add one in project settings so AI content can use it."}
          </p>
        </div>
        {project?.logoUrl ? (
          <a className="btn-outline kb-brand-open" href={project.logoUrl} target="_blank" rel="noreferrer">
            Open logo
          </a>
        ) : null}
      </section>

      <div
        className={`kb-dropzone${dragging ? " is-dragging" : ""}${uploading ? " is-busy" : ""}`}
        role="button"
        tabIndex={0}
        aria-label="Upload files to the knowledge base"
        onClick={() => !uploading && inputRef.current?.click()}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !uploading) {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          stageFiles(event.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={KNOWLEDGE_ACCEPT}
          hidden
          onChange={(event) => {
            if (event.target.files) stageFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <span className="kb-dropzone-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 16V4" />
            <path d="m7 9 5-5 5 5" />
            <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
          </svg>
        </span>
        <strong>{uploading ? "Converting files…" : "Drop files here or click to upload"}</strong>
        <span className="kb-dropzone-hint">
          PDF, Word, PowerPoint, Excel, CSV, TXT, Markdown, HTML or JSON · up to 20 MB each
        </span>
      </div>

      {pending.length > 0 ? (
        <section className="kb-naming" aria-label="Name your documents">
          <div className="kb-naming-head">
            <strong>Name {pending.length === 1 ? "this document" : `these ${pending.length} documents`}</strong>
            <span>The name is how the document appears here and how AI tools refer to it.</span>
          </div>
          <ul className="kb-naming-list">
            {pending.map((item) => {
              const invalid = showNameErrors && !item.name.trim();
              return (
                <li key={item.key} className="kb-naming-row">
                  <label className="kb-naming-field">
                    <span>Document name</span>
                    <input
                      value={item.name}
                      maxLength={160}
                      autoFocus={item.key === pending[0].key}
                      aria-invalid={invalid}
                      className={invalid ? "is-invalid" : undefined}
                      placeholder="e.g. Brand guidelines 2026"
                      onChange={(event) =>
                        setPending((current) =>
                          current.map((row) =>
                            row.key === item.key ? { ...row, name: event.target.value } : row,
                          ),
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          startUpload();
                        }
                      }}
                    />
                    {invalid ? <em>Enter a name for this document.</em> : null}
                  </label>
                  <span className="kb-naming-file" title={item.file.name}>
                    {item.file.name}
                    <small>{formatBytes(item.file.size)}</small>
                  </span>
                  <button
                    type="button"
                    className="kb-naming-remove"
                    aria-label={`Remove ${item.file.name}`}
                    onClick={() =>
                      setPending((current) => current.filter((row) => row.key !== item.key))
                    }
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="kb-naming-actions">
            <button type="button" className="btn-outline" onClick={() => setPending([])}>
              Cancel
            </button>
            <button type="button" className="btn-dark" onClick={startUpload}>
              Add {pending.length === 1 ? "to knowledge base" : `${pending.length} to knowledge base`}
            </button>
          </div>
        </section>
      ) : null}

      {queue.length > 0 ? (
        <ul className="kb-queue" aria-live="polite">
          {queue.map((item) => (
            <li key={item.key} className={`kb-queue-item is-${item.state}`}>
              <span className="kb-queue-name" title={item.name}>
                {item.name}
              </span>
              <span className="kb-queue-size">{formatBytes(item.size)}</span>
              <span className="kb-queue-state">
                {item.state === "waiting"
                  ? "Waiting"
                  : item.state === "converting"
                    ? "Converting to Markdown…"
                    : item.state === "done"
                      ? "Added"
                      : item.error}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="data-table-wrap kb-table-wrap">
        <table className="data-table kb-table">
          <thead>
            <tr>
              <th>Document</th>
              <th>Preview</th>
              <th>Type</th>
              <th>Added by</th>
              <th>Added</th>
              <th className="kb-actions-col" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="crm-empty-cell">
                  Loading knowledge base…
                </td>
              </tr>
            ) : docs.length === 0 ? (
              <tr>
                <td colSpan={6} className="crm-empty-cell">
                  No documents yet. Upload brand guides, product sheets, decks or FAQs to get started.
                </td>
              </tr>
            ) : (
              docs.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <button
                      type="button"
                      className="btn-link-purple kb-doc-title"
                      onClick={() => void openDoc(doc.id)}
                      disabled={viewLoadingId === doc.id}
                      title={doc.fileName}
                    >
                      {doc.title}
                    </button>
                    <span className="kb-doc-file">{doc.fileName}</span>
                  </td>
                  <td>
                    <span className="kb-preview" title={doc.preview}>
                      {doc.preview || "—"}
                    </span>
                    {doc.truncated ? (
                      <span className="kb-truncated">Very long file, only the first part was imported</span>
                    ) : null}
                  </td>
                  <td>
                    <span className="kb-type">{doc.fileType || "file"}</span>
                  </td>
                  <td>{doc.createdBy || "—"}</td>
                  <td>
                    <span className="kb-added">{formatDate(doc.createdAt)}</span>
                  </td>
                  <td className="kb-actions-col">
                    <div className="kb-actions">
                      <a
                        className="kb-icon-btn"
                        href={`/api/knowledge-base/${doc.id}?download=1`}
                        title="Download .md"
                        aria-label={`Download ${doc.title} as Markdown`}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M12 4v11" />
                          <path d="m7 10 5 5 5-5" />
                          <path d="M5 20h14" />
                        </svg>
                      </a>
                      <button
                        type="button"
                        className="enrich-icon-delete"
                        onClick={() => void deleteDoc(doc)}
                        disabled={deletingId === doc.id}
                        title="Delete"
                        aria-label={`Delete ${doc.title}`}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M3 6h18" />
                          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {viewing ? (
        <div className="crm-modal-backdrop" role="presentation" onMouseDown={() => setViewing(null)}>
          <div
            className="crm-modal kb-viewer"
            role="dialog"
            aria-modal="true"
            aria-label={viewing.title}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="crm-modal-head">
              <div>
                <h3>{viewing.title}</h3>
                <p className="kb-doc-file">
                  {viewing.fileName} · Added {formatDate(viewing.createdAt)}
                </p>
              </div>
              <div className="kb-viewer-actions">
                <a className="btn-outline" href={`/api/knowledge-base/${viewing.id}?download=1`}>
                  Download .md
                </a>
                <button
                  type="button"
                  className="crm-modal-close"
                  onClick={() => setViewing(null)}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="kb-viewer-body pa-md">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {viewing.markdown}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <PortalToast
          key={toast.key}
          variant={toast.variant}
          message={toast.message}
          onDone={() => setToast(null)}
        />
      ) : null}
    </div>
  );
}
