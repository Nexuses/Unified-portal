"use client";

import { FormEvent, useEffect, useState } from "react";
import type { Project } from "@/lib/projects";
import type { PortalUser } from "@/lib/users";

const emptyForm = {
  fullName: "",
  email: "",
  password: "",
  projectId: "",
};

export default function AdminUsersPanel() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [projectsRes, usersRes] = await Promise.all([
        fetch("/api/projects"),
        fetch("/api/users"),
      ]);
      const projectsData = await projectsRes.json();
      const usersData = await usersRes.json();

      if (!projectsRes.ok) {
        throw new Error(projectsData.error || "Failed to load projects");
      }
      if (!usersRes.ok) {
        throw new Error(usersData.error || "Failed to load users");
      }

      setProjects(projectsData);
      setUsers(usersData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  function startEdit(user: PortalUser) {
    setEditingId(user.id);
    setForm({
      fullName: user.fullName,
      email: user.email,
      password: "",
      projectId: user.projectId,
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
      fullName: form.fullName.trim(),
      email: form.email.trim(),
      password: form.password,
      projectId: form.projectId,
    };

    try {
      const response = await fetch(
        editingId ? `/api/users/${editingId}` : "/api/users",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to save user");
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
      setError(err instanceof Error ? err.message : "Failed to save user");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const confirmed = window.confirm("Delete this user?");
    if (!confirmed) return;

    setError("");
    try {
      const response = await fetch(`/api/users/${id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to delete user");
      }

      setUsers((current) => current.filter((user) => user.id !== id));
      if (editingId === id) {
        resetForm();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete user");
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-layout">
        <section className="admin-card admin-create-card">
          <h1 className="admin-card-title">
            {editingId ? "Edit user" : "New user"}
          </h1>
          <p className="admin-card-subtitle">
            Create users and assign them to a project workspace.
          </p>

          <form className="admin-form" onSubmit={handleSubmit}>
            <input
              className="admin-input"
              placeholder="Full Name"
              value={form.fullName}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  fullName: event.target.value,
                }))
              }
              required
            />
            <input
              className="admin-input"
              type="email"
              placeholder="Email"
              value={form.email}
              onChange={(event) =>
                setForm((current) => ({ ...current, email: event.target.value }))
              }
              required
            />
            <input
              className="admin-input"
              type="password"
              placeholder={
                editingId ? "Password (leave blank to keep current)" : "Password"
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
                    : "Create user"}
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
                  <th>Email</th>
                  <th>Project</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} className="admin-empty">
                      Loading users...
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="admin-empty">
                      No users yet. Create one on the left.
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
                      <td>{user.projectName}</td>
                      <td className="admin-actions">
                        <button
                          type="button"
                          className="admin-edit-link"
                          onClick={() => startEdit(user)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="admin-delete-link"
                          onClick={() => void handleDelete(user.id)}
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
