"use client";

import { FormEvent, useEffect, useState } from "react";
import type { Project } from "@/lib/projects";
import { slugify } from "@/lib/projects";

const emptyForm = {
  name: "",
  slug: "",
  logoUrl: "",
};

export default function AdminProjectsPanel() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [savingLimitId, setSavingLimitId] = useState<string | null>(null);
  const [limitDrafts, setLimitDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  async function loadProjects() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/projects");
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to load projects");
      }
      setProjects(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProjects();
  }, []);

  function startEdit(project: Project) {
    setEditingId(project.id);
    setForm({
      name: project.name,
      slug: project.slug,
      logoUrl: project.logoUrl,
    });
    setError("");
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");

    const payload = {
      name: form.name.trim(),
      slug: form.slug.trim() || slugify(form.name),
      logoUrl: form.logoUrl.trim(),
    };

    try {
      const response = await fetch(
        editingId ? `/api/projects/${editingId}` : "/api/projects",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to save project");
      }

      if (editingId) {
        setProjects((current) =>
          current.map((project) =>
            project.id === editingId ? { ...project, ...data } : project,
          ),
        );
      } else {
        setProjects((current) => [data, ...current]);
      }

      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save project");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const confirmed = window.confirm(
      "Delete this project and all users assigned to it?",
    );
    if (!confirmed) return;

    setError("");
    try {
      const response = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to delete project");
      }

      setProjects((current) => current.filter((project) => project.id !== id));
      if (editingId === id) {
        resetForm();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete project");
    }
  }

  async function toggleEngagementFlag(
    project: Project,
    field: "instantOpen" | "instantClick",
  ) {
    const next = !project[field];
    setTogglingId(`${project.id}:${field}`);
    setError("");
    setProjects((current) =>
      current.map((item) =>
        item.id === project.id ? { ...item, [field]: next } : item,
      ),
    );
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: next }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to update tracking setting");
      }
      setProjects((current) =>
        current.map((item) =>
          item.id === project.id ? { ...item, ...data } : item,
        ),
      );
    } catch (err) {
      setProjects((current) =>
        current.map((item) =>
          item.id === project.id ? { ...item, [field]: project[field] } : item,
        ),
      );
      setError(
        err instanceof Error ? err.message : "Failed to update tracking setting",
      );
    } finally {
      setTogglingId(null);
    }
  }

  async function saveSendingLimit(project: Project) {
    const raw = limitDrafts[project.id] ?? String(project.sendingLimit ?? 50000);
    const parsed = Number(String(raw).replace(/,/g, "").trim());
    if (!Number.isFinite(parsed) || parsed < 1) {
      setError("Sending limit must be at least 1.");
      setLimitDrafts((current) => ({
        ...current,
        [project.id]: String(project.sendingLimit ?? 50000),
      }));
      return;
    }
    const next = Math.min(Math.floor(parsed), 10_000_000);
    if (next === project.sendingLimit) {
      setLimitDrafts((current) => {
        const copy = { ...current };
        delete copy[project.id];
        return copy;
      });
      return;
    }

    setSavingLimitId(project.id);
    setError("");
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sendingLimit: next }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to update sending limit");
      }
      setProjects((current) =>
        current.map((item) =>
          item.id === project.id ? { ...item, ...data } : item,
        ),
      );
      setLimitDrafts((current) => {
        const copy = { ...current };
        delete copy[project.id];
        return copy;
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update sending limit",
      );
      setLimitDrafts((current) => ({
        ...current,
        [project.id]: String(project.sendingLimit ?? 50000),
      }));
    } finally {
      setSavingLimitId(null);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-layout">
        <section className="admin-card admin-create-card">
          <h1 className="admin-card-title">
            {editingId ? "Edit project" : "New project"}
          </h1>
          <p className="admin-card-subtitle">
            Each project is an isolated outreach workspace with its own logo in
            the user sidebar.
          </p>

          <form className="admin-form" onSubmit={handleSubmit}>
            <label className="admin-field">
              <span className="admin-field-label">Project name</span>
              <input
                className="admin-input"
                placeholder="e.g. PurpleSynapz"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                required
              />
            </label>
            <label className="admin-field">
              <span className="admin-field-label">Slug</span>
              <input
                className="admin-input"
                placeholder="Optional, e.g. acme-corp"
                value={form.slug}
                onChange={(event) =>
                  setForm((current) => ({ ...current, slug: event.target.value }))
                }
              />
            </label>
            <label className="admin-field">
              <span className="admin-field-label">Logo URL</span>
              <input
                className="admin-input"
                placeholder="Shown at bottom of user sidebar"
                value={form.logoUrl}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    logoUrl: event.target.value,
                  }))
                }
              />
            </label>

            {error ? <p className="admin-error">{error}</p> : null}

            <div className="admin-form-actions">
              {editingId ? (
                <button
                  type="button"
                  className="admin-secondary-btn"
                  onClick={resetForm}
                >
                  Cancel
                </button>
              ) : null}
              <button type="submit" className="admin-primary-btn" disabled={saving}>
                {saving
                  ? "Saving..."
                  : editingId
                    ? "Save changes"
                    : "Create project"}
              </button>
            </div>
          </form>
        </section>

        <section className="admin-card admin-list-card">
          <div className="admin-list-card-header">
            <h2 className="admin-list-card-title">All projects</h2>
            <span className="admin-list-card-count">
              {loading ? "..." : `${projects.length} total`}
            </span>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Slug</th>
                  <th>Users</th>
                  <th>Logo</th>
                  <th>Sending limit</th>
                  <th>Action</th>
                  <th aria-label="Manage" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="admin-empty">
                      Loading projects...
                    </td>
                  </tr>
                ) : projects.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="admin-empty">
                      No projects yet. Create one on the left.
                    </td>
                  </tr>
                ) : (
                  projects.map((project) => (
                    <tr key={project.id}>
                      <td>
                        <button
                          type="button"
                          className="admin-name-btn"
                          onClick={() => startEdit(project)}
                        >
                          {project.name}
                        </button>
                      </td>
                      <td>
                        <span className="admin-slug">{project.slug}</span>
                      </td>
                      <td>
                        <span className="admin-user-count">{project.users}</span>
                      </td>
                      <td className="admin-logo-cell">
                        {project.logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={project.logoUrl}
                            alt={`${project.name} logo`}
                            className="admin-logo"
                          />
                        ) : (
                          <span className="admin-logo-fallback">—</span>
                        )}
                      </td>
                      <td>
                        <label className="admin-sending-limit">
                          <input
                            className="admin-sending-limit-input"
                            type="number"
                            min={1}
                            step={1}
                            inputMode="numeric"
                            value={
                              limitDrafts[project.id] ??
                              String(project.sendingLimit ?? 50000)
                            }
                            disabled={savingLimitId === project.id}
                            aria-label={`Sending limit for ${project.name}`}
                            onChange={(event) =>
                              setLimitDrafts((current) => ({
                                ...current,
                                [project.id]: event.target.value,
                              }))
                            }
                            onBlur={() => void saveSendingLimit(project)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.currentTarget.blur();
                              }
                            }}
                          />
                        </label>
                      </td>
                      <td>
                        <div className="admin-open-click-action">
                          <div className="admin-toggle-row">
                            <button
                              type="button"
                              className={`admin-toggle${project.instantOpen ? " on" : ""}`}
                              role="switch"
                              aria-checked={project.instantOpen}
                              aria-label={`Open tracking for ${project.name}`}
                              title={
                                project.instantOpen
                                  ? "ON: opens counted immediately (no delay)"
                                  : "OFF: normal open bot-grace delay applies"
                              }
                              disabled={togglingId === `${project.id}:instantOpen`}
                              onClick={() =>
                                void toggleEngagementFlag(project, "instantOpen")
                              }
                            >
                              <span className="admin-toggle-knob" />
                            </button>
                            <span className="admin-open-click-label">
                              Open
                              <span className="admin-open-click-state">
                                {project.instantOpen ? "On" : "Off"}
                              </span>
                            </span>
                          </div>
                          <div className="admin-toggle-row">
                            <button
                              type="button"
                              className={`admin-toggle${project.instantClick ? " on" : ""}`}
                              role="switch"
                              aria-checked={project.instantClick}
                              aria-label={`Click tracking for ${project.name}`}
                              title={
                                project.instantClick
                                  ? "ON: clicks counted immediately (no delay)"
                                  : "OFF: normal click bot-grace delay applies"
                              }
                              disabled={togglingId === `${project.id}:instantClick`}
                              onClick={() =>
                                void toggleEngagementFlag(project, "instantClick")
                              }
                            >
                              <span className="admin-toggle-knob" />
                            </button>
                            <span className="admin-open-click-label">
                              Click
                              <span className="admin-open-click-state">
                                {project.instantClick ? "On" : "Off"}
                              </span>
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="admin-actions">
                        <div className="admin-action-group">
                          <button
                            type="button"
                            className="admin-action-btn admin-action-btn--edit"
                            onClick={() => startEdit(project)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="admin-action-btn admin-action-btn--delete"
                            onClick={() => void handleDelete(project.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
