"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Bucket = { name: string; region: string };

type BucketFile = {
  key: string;
  name: string;
  size: number;
  updatedAt?: string;
  url: string;
  bucket?: string;
};

type ViewMode = "cards" | "list";
type TypeFilter =
  | "all"
  | "images"
  | "video"
  | "pdf"
  | "html"
  | "docs"
  | "other";

const PAGE_SIZE = 50;
const ALL_BUCKETS = "all";

const TYPE_FILTERS: Array<{ id: TypeFilter; label: string }> = [
  { id: "all", label: "All types" },
  { id: "images", label: "Images" },
  { id: "video", label: "Video" },
  { id: "pdf", label: "PDF" },
  { id: "html", label: "HTML" },
  { id: "docs", label: "Docs" },
  { id: "other", label: "Other" },
];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function isImageFile(name: string) {
  return ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"].includes(
    extensionOf(name),
  );
}

function isVideoFile(name: string) {
  return ["mp4", "webm", "mov", "m4v"].includes(extensionOf(name));
}

function FilePreview({ file }: { file: BucketFile }) {
  const [broken, setBroken] = useState(false);
  if (isImageFile(file.name) && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={file.url}
        alt={file.name}
        className="fm-card-preview-media"
        loading="lazy"
        onError={() => setBroken(true)}
      />
    );
  }
  if (isVideoFile(file.name) && !broken) {
    return (
      <video
        className="fm-card-preview-media"
        src={file.url}
        muted
        preload="metadata"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <div className="fm-card-preview-fallback" aria-hidden="true">
      <span>{extensionOf(file.name).toUpperCase() || "FILE"}</span>
    </div>
  );
}

export default function PortalFileManagerPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [projectName, setProjectName] = useState("");
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [bucket, setBucket] = useState(ALL_BUCKETS);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [files, setFiles] = useState<BucketFile[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [view, setView] = useState<ViewMode>("cards");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadBucket, setUploadBucket] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copiedKey, setCopiedKey] = useState("");

  const load = useCallback(
    async (options?: {
      nextBucket?: string;
      page?: number;
      type?: TypeFilter;
      q?: string;
    }) => {
      setLoading(true);
      setError("");
      try {
        const nextBucket = options?.nextBucket ?? bucket;
        const nextPage = options?.page ?? page;
        const nextType = options?.type ?? typeFilter;
        const nextQuery = options?.q ?? searchQuery;
        const params = new URLSearchParams({
          bucket: nextBucket || ALL_BUCKETS,
          page: String(Math.max(1, nextPage)),
          type: nextType,
        });
        if (nextQuery.trim()) {
          params.set("q", nextQuery.trim());
        }
        const response = await fetch(`/api/file-manager?${params}`, {
          cache: "no-store",
        });
        const data = (await response.json()) as {
          projectName?: string;
          buckets?: Bucket[];
          bucket?: string;
          type?: TypeFilter;
          q?: string;
          files?: BucketFile[];
          page?: number;
          total?: number;
          totalPages?: number;
          truncated?: boolean;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(data.error || "Could not load files");
        }
        setProjectName(data.projectName || "");
        setBuckets(data.buckets || []);
        setBucket(data.bucket || ALL_BUCKETS);
        setTypeFilter(data.type || nextType);
        setSearchQuery(data.q ?? nextQuery);
        setFiles(data.files || []);
        setPage(data.page || 1);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 0);
        setTruncated(Boolean(data.truncated));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load files");
        setFiles([]);
        setTotal(0);
        setTotalPages(0);
      } finally {
        setLoading(false);
      }
    },
    [bucket, page, searchQuery, typeFilter],
  );

  useEffect(() => {
    void load({ nextBucket: ALL_BUCKETS, page: 1, type: "all", q: "" });
    // Initial load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === searchQuery) {
      return;
    }
    const timer = window.setTimeout(() => {
      setSearchQuery(trimmed);
      setNotice("");
      void load({ q: trimmed, page: 1 });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [load, searchInput, searchQuery]);

  function selectBucket(name: string) {
    if (name === bucket && !loading) {
      return;
    }
    setBucket(name);
    setNotice("");
    void load({ nextBucket: name, page: 1 });
  }

  function selectType(next: TypeFilter) {
    if (next === typeFilter && !loading) {
      return;
    }
    setTypeFilter(next);
    setNotice("");
    void load({ type: next, page: 1 });
  }

  function openUploadModal() {
    if (buckets.length === 0 || uploading) {
      return;
    }
    const preferred =
      bucket !== ALL_BUCKETS && buckets.some((item) => item.name === bucket)
        ? bucket
        : buckets[0]?.name || "";
    setUploadBucket(preferred);
    setUploadFile(null);
    setUploadOpen(true);
    setError("");
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  function closeUploadModal() {
    if (uploading) {
      return;
    }
    setUploadOpen(false);
    setUploadFile(null);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  async function submitUpload() {
    if (!uploadFile || uploading) {
      return;
    }
    if (!uploadBucket || uploadBucket === ALL_BUCKETS) {
      setError("Pick a bucket to upload into.");
      return;
    }
    setUploading(true);
    setError("");
    setNotice("");
    try {
      const body = new FormData();
      body.set("file", uploadFile);
      body.set("bucket", uploadBucket);
      body.set("type", typeFilter);
      if (searchQuery.trim()) {
        body.set("q", searchQuery.trim());
      }
      const response = await fetch("/api/file-manager", {
        method: "POST",
        body,
      });
      const data = (await response.json()) as {
        url?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "Upload failed");
      }
      setUploadOpen(false);
      setUploadFile(null);
      setNotice(`Uploaded ${uploadFile.name} to ${uploadBucket}`);
      if (data.url) {
        try {
          await navigator.clipboard.writeText(data.url);
          setCopiedKey(data.url);
        } catch {
          /* clipboard optional */
        }
      }
      await load({ page: 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedKey(url);
      setNotice("Link copied");
    } catch {
      setError("Could not copy the link");
    }
  }

  const canUpload = buckets.length > 0;
  const rangeStart = files.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = (page - 1) * PAGE_SIZE + files.length;

  return (
    <div className="fm-page">
      <div className="crm-page-head">
        <div>
          <h2>File Manager</h2>
          <p className="desc">
            Browse every project bucket, preview files, and upload with public
            links
            {projectName ? ` for ${projectName}` : ""}.
          </p>
        </div>
        <div className="crm-actions">
          <div className="fm-view-toggle" role="group" aria-label="View mode">
            <button
              type="button"
              className={view === "cards" ? "is-active" : ""}
              onClick={() => setView("cards")}
            >
              Cards
            </button>
            <button
              type="button"
              className={view === "list" ? "is-active" : ""}
              onClick={() => setView("list")}
            >
              List
            </button>
          </div>
          <button
            type="button"
            className="btn-soft"
            disabled={loading || uploading}
            onClick={() => void load({ page: 1 })}
          >
            Refresh
          </button>
          <button
            type="button"
            className="btn-dark"
            disabled={loading || uploading || !canUpload}
            title={
              canUpload ? "Upload a file" : "No buckets available to upload"
            }
            onClick={openUploadModal}
          >
            {uploading ? "Uploading…" : "Upload file"}
          </button>
        </div>
      </div>

      {error ? <p className="crm-error">{error}</p> : null}
      {notice ? <p className="fm-notice">{notice}</p> : null}
      {truncated ? (
        <p className="fm-notice">
          Showing the newest {total.toLocaleString()} files (list capped for
          speed).
        </p>
      ) : null}

      <div className="fm-search" role="search">
        <label className="fm-buckets-label" htmlFor="fm-search-input">
          Search
        </label>
        <div className="search-input fm-search-input">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path
              d="M20 20l-3.5-3.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <input
            id="fm-search-input"
            className="lists-search-input"
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search by file name…"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="fm-toolbar" aria-label="Buckets and filters">
        <div className="fm-toolbar-group" aria-label="Buckets">
          <div className="fm-buckets-label">All buckets</div>
          <div className="fm-buckets-row">
            <button
              type="button"
              className={`fm-bucket-chip${
                bucket === ALL_BUCKETS ? " is-active" : ""
              }`}
              onClick={() => selectBucket(ALL_BUCKETS)}
            >
              <strong>All</strong>
              <span>
                {buckets.length} bucket{buckets.length === 1 ? "" : "s"}
              </span>
            </button>
            {buckets.map((item) => (
              <button
                key={item.name}
                type="button"
                className={`fm-bucket-chip${
                  bucket === item.name ? " is-active" : ""
                }`}
                onClick={() => selectBucket(item.name)}
                title={`${item.name} (${item.region})`}
              >
                <strong>{item.name}</strong>
                <span>{item.region}</span>
              </button>
            ))}
            {buckets.length === 0 ? (
              <p className="fm-nav-empty">No buckets found</p>
            ) : null}
          </div>
        </div>
        <div className="fm-toolbar-divider" aria-hidden="true" />
        <div className="fm-toolbar-group fm-filters" aria-label="File type filters">
          <div className="fm-buckets-label">Filter</div>
          <div className="fm-filter-row">
            {TYPE_FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`fm-filter-chip${
                  typeFilter === item.id ? " is-active" : ""
                }`}
                onClick={() => selectType(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="fm-main">
        {loading ? (
          <div className="crm-empty">Loading files…</div>
        ) : buckets.length === 0 ? (
          <div className="crm-empty">
            No S3 buckets match this project name yet. Create a bucket that
            includes the project name, then refresh.
          </div>
        ) : files.length === 0 ? (
          <div className="crm-empty">
            {searchQuery.trim()
              ? `No files match “${searchQuery.trim()}”.`
              : typeFilter !== "all"
                ? "No files match this filter."
                : bucket === ALL_BUCKETS
                  ? "No files in these buckets yet."
                  : "This bucket is empty. Upload a file to get a public link."}
          </div>
        ) : view === "cards" ? (
          <div className="fm-card-grid">
            {files.map((file) => (
              <article
                key={`${file.bucket || bucket}:${file.key}`}
                className="fm-card"
              >
                <div className="fm-card-preview">
                  <FilePreview file={file} />
                </div>
                <div className="fm-card-body">
                  <strong title={file.key}>{file.name}</strong>
                  <span>
                    {formatBytes(file.size)} · {formatDate(file.updatedAt)}
                    {bucket === ALL_BUCKETS && file.bucket
                      ? ` · ${file.bucket}`
                      : ""}
                  </span>
                  <div className="fm-link-actions">
                    <a
                      href={file.url}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-soft"
                    >
                      Open
                    </a>
                    <button
                      type="button"
                      className="btn-soft"
                      onClick={() => void copyLink(file.url)}
                    >
                      {copiedKey === file.url ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="fm-table-wrap">
            <table className="fm-table">
              <thead>
                <tr>
                  <th>Preview</th>
                  <th>Name</th>
                  {bucket === ALL_BUCKETS ? <th>Bucket</th> : null}
                  <th>Size</th>
                  <th>Updated</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={`${file.bucket || bucket}:${file.key}`}>
                    <td>
                      <div className="fm-row-preview">
                        <FilePreview file={file} />
                      </div>
                    </td>
                    <td>
                      <div className="fm-name">
                        <strong title={file.key}>{file.name}</strong>
                        <span>{file.key}</span>
                      </div>
                    </td>
                    {bucket === ALL_BUCKETS ? (
                      <td>{file.bucket || "—"}</td>
                    ) : null}
                    <td>{formatBytes(file.size)}</td>
                    <td>{formatDate(file.updatedAt)}</td>
                    <td>
                      <div className="fm-link-actions">
                        <a
                          href={file.url}
                          target="_blank"
                          rel="noreferrer"
                          className="btn-soft"
                        >
                          Open
                        </a>
                        <button
                          type="button"
                          className="btn-soft"
                          onClick={() => void copyLink(file.url)}
                        >
                          {copiedKey === file.url ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && (total > 0 || totalPages > 0) ? (
          <div className="fm-pagination">
            <span>
              Showing {rangeStart}-{rangeEnd} of {total.toLocaleString()} ·{" "}
              {PAGE_SIZE} per page
            </span>
            <div className="fm-pagination-actions">
              <button
                type="button"
                className="btn-soft"
                disabled={page <= 1 || loading}
                onClick={() => void load({ page: page - 1 })}
              >
                Previous
              </button>
              <span className="fm-page-label">
                Page {totalPages === 0 ? 0 : page} of {totalPages}
              </span>
              <button
                type="button"
                className="btn-soft"
                disabled={page >= totalPages || loading}
                onClick={() => void load({ page: page + 1 })}
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {uploadOpen ? (
        <div
          className="crm-modal-backdrop"
          role="presentation"
          onClick={closeUploadModal}
        >
          <div
            className="crm-modal fm-upload-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fm-upload-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="crm-modal-head">
              <div>
                <h3 id="fm-upload-title">Upload file</h3>
                <p>Choose a bucket, then pick the file to upload.</p>
              </div>
              <button
                type="button"
                className="crm-modal-close"
                aria-label="Close"
                onClick={closeUploadModal}
                disabled={uploading}
              >
                ×
              </button>
            </div>
            <div className="crm-modal-body">
              <label className="crm-field">
                <span>Bucket</span>
                <select
                  value={uploadBucket}
                  onChange={(event) => setUploadBucket(event.target.value)}
                  disabled={uploading || buckets.length === 0}
                >
                  {buckets.length === 0 ? (
                    <option value="">No buckets available</option>
                  ) : null}
                  {buckets.map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name} ({item.region})
                    </option>
                  ))}
                </select>
              </label>
              <div className="crm-field">
                <span>File</span>
                <div className="fm-upload-file-row">
                  <button
                    type="button"
                    className="btn-soft"
                    disabled={uploading}
                    onClick={() => inputRef.current?.click()}
                  >
                    Choose file
                  </button>
                  <span className="fm-upload-file-name">
                    {uploadFile ? uploadFile.name : "No file selected"}
                  </span>
                  <input
                    ref={inputRef}
                    type="file"
                    hidden
                    onChange={(event) => {
                      setUploadFile(event.target.files?.[0] || null);
                    }}
                  />
                </div>
              </div>
            </div>
            <div className="crm-modal-foot">
              <button
                type="button"
                className="btn-soft"
                onClick={closeUploadModal}
                disabled={uploading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-dark"
                disabled={
                  uploading || !uploadBucket || !uploadFile || buckets.length === 0
                }
                onClick={() => void submitUpload()}
              >
                {uploading ? "Uploading…" : "Upload"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
