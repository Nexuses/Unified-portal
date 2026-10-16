"use client";

import { useEffect, useRef, useState } from "react";

type Memory = {
  id: string;
  title: string;
  text: string;
  preview: string;
  fileName: string;
  updatedAt: string;
};

type Branding = {
  name: string;
  logoUrl: string;
  colors: string[];
  fromGuidelines: boolean;
  memories: Memory[];
};

function applyBrand(data: Branding, setBrand: (brand: Branding) => void) {
  setBrand({
    name: data.name ?? "",
    logoUrl: data.logoUrl ?? "",
    colors: data.colors ?? [],
    fromGuidelines: Boolean(data.fromGuidelines),
    memories: data.memories ?? [],
  });
}

export default function PortalBrandingPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [brand, setBrand] = useState<Branding | null>(null);
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [editingId, setEditingId] = useState("");
  const [editText, setEditText] = useState("");
  const [error, setError] = useState("");
  const [savedNote, setSavedNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/branding", { cache: "no-store" });
        const data = (await response.json()) as Branding & { error?: string };
        if (!response.ok) throw new Error(data.error || "Failed to load branding");
        if (!cancelled) applyBrand(data, setBrand);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load branding");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const name = brand?.name || "This project";

  async function readPayload(response: Response) {
    const data = (await response.json()) as Branding & { error?: string };
    if (!response.ok) throw new Error(data.error || "Could not save that memory");
    applyBrand(data, setBrand);
    return data;
  }

  async function saveNew() {
    if (!brand || saving) return;
    if (!draft.trim() && !file) {
      setError("Paste a guideline or choose a file.");
      return;
    }
    setSaving(true);
    setError("");
    setSavedNote("");
    try {
      const response = file
        ? await fetch("/api/branding", {
            method: "POST",
            body: (() => {
              const form = new FormData();
              form.set("file", file);
              if (draft.trim()) form.set("text", draft);
              return form;
            })(),
          })
        : await fetch("/api/branding", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: draft }),
          });
      const saved = await readPayload(response);
      setDraft("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      const title = saved.memories[0]?.title;
      setSavedNote(
        title
          ? file
            ? `Added as "${title}". The file was saved as Markdown.`
            : `Added as "${title}".`
          : "Added. This memory is saved.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that memory");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(id: string) {
    if (busyId) return;
    setBusyId(id);
    setError("");
    try {
      const response = await fetch(`/api/branding/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: editText }),
      });
      await readPayload(response);
      setEditingId("");
      setEditText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update that memory");
    } finally {
      setBusyId("");
    }
  }

  async function remove(id: string) {
    if (busyId) return;
    if (!window.confirm("Delete this brand memory?")) return;
    setBusyId(id);
    setError("");
    try {
      const response = await fetch(`/api/branding/${id}`, { method: "DELETE" });
      await readPayload(response);
      if (editingId === id) {
        setEditingId("");
        setEditText("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete that memory");
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="kb-page">
      <div className="crm-page-head">
        <div>
          <h2>Branding</h2>
          <p className="desc">
            Save guidelines as memories. Paste design and voice notes, or upload a file. Emails, posts, and pitches follow every memory, and brand colors update from the colors in them.
          </p>
        </div>
      </div>

      {error ? <p className="crm-error">{error}</p> : null}
      {!brand && !error ? <p className="personalise-lead">Loading branding…</p> : null}

      {brand ? (
        <>
          <section className="kb-brand" aria-label="Client logo">
            <div className="kb-brand-logo">
              {brand.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={brand.logoUrl} alt={`${name} logo`} />
              ) : (
                <span>{name.slice(0, 1).toUpperCase() || "B"}</span>
              )}
            </div>
            <div className="kb-brand-text">
              <span className="kb-brand-label">Logo</span>
              <strong>{name}</strong>
              <p>
                {brand.logoUrl
                  ? "This logo is placed on generated emails and social posts."
                  : "No logo yet. Add one in admin project settings so generated content can use it."}
              </p>
            </div>
            {brand.logoUrl ? (
              <a className="btn-outline kb-brand-open" href={brand.logoUrl} target="_blank" rel="noreferrer">
                Open logo
              </a>
            ) : null}
          </section>

          <section className="brand-colors" aria-label="Brand colors">
            <h3>Brand colors</h3>
            {brand.colors.length > 0 ? (
              <>
                <ul>
                  {brand.colors.map((color) => (
                    <li key={color}>
                      <span className="brand-swatch" style={{ background: color }} />
                      <code>{color}</code>
                    </li>
                  ))}
                </ul>
                <p>
                  {brand.fromGuidelines
                    ? "Taken from the colors in your guideline memories."
                    : "Taken from the logo. Name hex colors in a memory and these update."}
                </p>
              </>
            ) : (
              <p>Name hex colors in a guideline, or set a logo, and they show up here.</p>
            )}
          </section>

          <section className="brand-composer" aria-label="Add a brand memory">
            <h3>Add a memory</h3>
            <p>Paste a design system, vocal tone, or any guideline. An uploaded file is converted to Markdown and saved as a memory.</p>
            <textarea
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setSavedNote("");
              }}
              placeholder="Paste brand guidelines, colors like #0b996e, type rules, or how the writing should sound…"
              spellCheck
            />
            <div className="brand-composer-actions">
              <label className="btn-outline brand-file">
                Upload a file
                <input
                  ref={fileRef}
                  type="file"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setSavedNote("");
                  }}
                />
              </label>
              {file ? <span className="brand-file-name">{file.name}</span> : null}
              {file ? (
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => {
                    setFile(null);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                >
                  Remove file
                </button>
              ) : null}
              <button type="button" className="btn-dark" disabled={saving} onClick={() => void saveNew()}>
                {saving ? "Saving…" : "Save memory"}
              </button>
              {savedNote ? <span className="brand-success">{savedNote}</span> : null}
            </div>
          </section>

          <section className="brand-memories" aria-label="Saved memories">
            {brand.memories.length === 0 ? (
              <p className="brand-empty">No memories yet. Save a guideline and it shows up here as a card.</p>
            ) : (
              <ul>
                {brand.memories.map((memory) => {
                  const editing = editingId === memory.id;
                  return (
                    <li key={memory.id} className="brand-memory">
                      <div className="brand-memory-head">
                        <strong>{memory.title}</strong>
                        {memory.fileName ? <span>{memory.fileName}</span> : null}
                      </div>
                      {editing ? (
                        <textarea
                          value={editText}
                          onChange={(event) => setEditText(event.target.value)}
                          spellCheck
                        />
                      ) : (
                        <p>{memory.preview}</p>
                      )}
                      <div className="brand-memory-actions">
                        {editing ? (
                          <>
                            <button
                              type="button"
                              className="btn-dark"
                              disabled={busyId === memory.id}
                              onClick={() => void saveEdit(memory.id)}
                            >
                              {busyId === memory.id ? "Saving…" : "Save"}
                            </button>
                            <button
                              type="button"
                              className="btn-outline"
                              onClick={() => {
                                setEditingId("");
                                setEditText("");
                              }}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn-outline"
                            onClick={() => {
                              setEditingId(memory.id);
                              setEditText(memory.text);
                            }}
                          >
                            Edit
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-outline"
                          disabled={busyId === memory.id}
                          onClick={() => void remove(memory.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
