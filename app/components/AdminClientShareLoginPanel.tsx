"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Project } from "@/lib/projects";
import type { PortalPageId } from "@/lib/portal-nav";
import type { AssignableNavOption } from "@/lib/portal-nav-access";
import type { ClientShareUser } from "@/lib/client-share-users-server";

const emptyForm = {
  fullName: "",
  email: "",
  password: "",
  projectId: "",
  allowedNavPages: [] as PortalPageId[],
};

export default function AdminClientShareLoginPanel() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<ClientShareUser[]>([]);
  const [navOptions, setNavOptions] = useState<AssignableNavOption[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const navBySection = useMemo(() => {
    const map = new Map<string, AssignableNavOption[]>();
    for (const option of navOptions) {
      const list = map.get(option.section) || [];
      list.push(option);
      map.set(option.section, list);
    }
    return [...map.entries()];
  }, [navOptions]);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [projectsRes, shareRes] = await Promise.all([
        fetch("/api/projects"),
        fetch("/api/admin/client-share-users"),
      ]);
      const projectsData = await projectsRes.json();
      const shareData = (await shareRes.json()) as {
        users?: ClientShareUser[];
        navOptions?: AssignableNavOption[];
        error?: string;
      };

      if (!projectsRes.ok) {
        throw new Error(projectsData.error || "Failed to load projects");
      }
      if (!shareRes.ok) {
        throw new Error(shareData.error || "Failed to load client share logins");
      }

      setProjects(projectsData);
      setUsers(shareData.users || []);
      setNavOptions(shareData.navOptions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  function startEdit(user: ClientShareUser) {
    setEditingId(user.id);
    setForm({
      fullName: user.fullName,
      email: user.email,
      password: "",
      projectId: user.projectId,
      allowedNavPages: [...user.allowedNavPages],
    });
    setError("");
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
  }

  function toggleNavPage(pageId: PortalPageId) {
    setForm((current) => {
      const selected = new Set(current.allowedNavPages);
      if (selected.has(pageId)) {
        selected.delete(pageId);
      } else {
        selected.add(pageId);
      }
      return { ...current, allowedNavPages: [...selected] };
    });
  }

  function toggleSection(section: string, checked: boolean) {
    const sectionIds = navOptions
      .filter((option) => option.section === section)
      .map((option) => option.id);
    setForm((current) => {
      const selected = new Set(current.allowedNavPages);
      for (const id of sectionIds) {
        if (checked) {
          selected.add(id);
        } else {
          selected.delete(id);
        }
      }
      return { ...current, allowedNavPages: [...selected] };
    });
  }

  function isSectionFullySelected(section: string) {
    const sectionIds = navOptions
      .filter((option) => option.section === section)
      .map((option) => option.id);
    return sectionIds.every((id) => form.allowedNavPages.includes(id));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");

    const payload = {
      fullName: form.fullName.trim(),
      email: form.email.trim(),
      password: form.password,
      projectId: form.projectId,
      allowedNavPages: form.allowedNavPages,
    };

    try {
      const response = await fetch(
        editingId
          ? `/api/admin/client-share-users/${editingId}`
          : "/api/admin/client-share-users",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = (await response.json()) as ClientShareUser & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Failed to save client share login");
      }

      if (editingId) {
        setUsers((current) =>
          current.map((user) => (user.id === editingId ? { ...user, ...data } : user)),
        );
      } else {
        setUsers((current) => [data, ...current]);
      }

      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save client share login");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const confirmed = window.confirm("Delete this client share login?");
    if (!confirmed) return;

    setError("");
    try {
      const response = await fetch(`/api/admin/client-share-users/${id}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Failed to delete client share login");
      }

      setUsers((current) => current.filter((user) => user.id !== id));
      if (editingId === id) {
        resetForm();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete client share login");
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-layout admin-layout--stack">
        <section className="admin-card admin-create-card">
          <h1 className="admin-card-title">
            {editingId ? "Edit client share login" : "New client share login"}
          </h1>
          <p className="admin-card-subtitle">
            Create a portal login for a client. Pick their project and choose which
            sidebar sections they can open. They sign in at the same portal login page
            as your team.
          </p>

          <form className="admin-form" onSubmit={handleSubmit}>
            <label className="admin-field">
              <span className="admin-field-label">Full name</span>
              <input
                className="admin-input"
                placeholder="Client contact name"
                value={form.fullName}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    fullName: event.target.value,
                  }))
                }
                required
              />
            </label>
            <label className="admin-field">
              <span className="admin-field-label">Email</span>
              <input
                className="admin-input"
                type="email"
                placeholder="client@company.com"
                value={form.email}
                onChange={(event) =>
                  setForm((current) => ({ ...current, email: event.target.value }))
                }
                required
              />
            </label>
            <label className="admin-field">
              <span className="admin-field-label">Password</span>
              <input
                className="admin-input"
                type="password"
                placeholder={
                  editingId ? "Leave blank to keep current password" : "Create a password"
                }
                value={form.password}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
                required={!editingId}
              />
            </label>
            <label className="admin-field">
              <span className="admin-field-label">Project</span>
              <select
                className="admin-input admin-select"
                value={form.projectId}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    projectId: event.target.value,
                  }))
                }
                required
              >
                <option value="">Select project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="admin-field">
              <span className="admin-field-label">Portal sections they can view</span>
              <p className="admin-field-hint">
                Selected: {form.allowedNavPages.length} section
                {form.allowedNavPages.length === 1 ? "" : "s"}
              </p>
              <div className="admin-nav-permissions">
                {navBySection.map(([section, options]) => (
                  <div key={section} className="admin-nav-permissions-section">
                    <label className="admin-nav-permissions-section-head">
                      <input
                        type="checkbox"
                        checked={isSectionFullySelected(section)}
                        onChange={(event) =>
                          toggleSection(section, event.target.checked)
                        }
                      />
                      <span>{section}</span>
                    </label>
                    <div className="admin-nav-permissions-grid">
                      {options.map((option) => (
                        <label key={option.id} className="admin-nav-permissions-item">
                          <input
                            type="checkbox"
                            checked={form.allowedNavPages.includes(option.id)}
                            onChange={() => toggleNavPage(option.id)}
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

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
                    : "Create client login"}
              </button>
            </div>
          </form>
        </section>

        <section className="admin-card admin-list-card">
          <div className="admin-list-card-header">
            <h2 className="admin-list-card-title">Client share logins</h2>
            <span className="admin-list-card-count">
              {loading ? "..." : `${users.length} total`}
            </span>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Project</th>
                  <th>Sections</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="admin-empty">
                      Loading client share logins...
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="admin-empty">
                      No client share logins yet. Create one above.
                    </td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <button
                          type="button"
                          className="admin-name-btn"
                          onClick={() => startEdit(user)}
                        >
                          {user.fullName}
                        </button>
                      </td>
                      <td>{user.email}</td>
                      <td>
                        <span className="admin-project-badge">{user.projectName}</span>
                      </td>
                      <td>
                        <span className="admin-nav-count-badge">
                          {user.allowedNavPages.length} enabled
                        </span>
                      </td>
                      <td className="admin-actions">
                        <div className="admin-action-group">
                          <button
                            type="button"
                            className="admin-action-btn admin-action-btn--edit"
                            onClick={() => startEdit(user)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="admin-action-btn admin-action-btn--delete"
                            onClick={() => void handleDelete(user.id)}
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
