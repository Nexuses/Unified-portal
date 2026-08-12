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
    const confirmed = window.confirm("Delete this project?");
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
            <input
              className="admin-input"
              placeholder="Project name"
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              required
            />
            <input
              className="admin-input"
              placeholder="Slug (optional, e.g. acme-corp)"
              value={form.slug}
              onChange={(event) =>
                setForm((current) => ({ ...current, slug: event.target.value }))
              }
            />
            <input
              className="admin-input"
              placeholder="Logo URL (shown at bottom of user sidebar)"
              value={form.logoUrl}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  logoUrl: event.target.value,
                }))
              }
            />

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
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Slug</th>
                  <th>Users</th>
                  <th>Logo</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="admin-empty">
                      Loading projects...
                    </td>
                  </tr>
                ) : projects.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="admin-empty">
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
                      <td>{project.slug}</td>
                      <td>{project.users}</td>
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
                      <td className="admin-actions">
                        <button
                          type="button"
                          className="admin-edit-link"
                          onClick={() => startEdit(project)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="admin-delete-link"
                          onClick={() => void handleDelete(project.id)}
                        >
                          Delete
                        </button>
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
