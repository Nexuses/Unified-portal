"use client";

import { useState } from "react";
import AdminProjectsPanel from "./AdminProjectsPanel";
import AdminUsersPanel from "./AdminUsersPanel";

type TabKey = "project" | "users";

export default function AdminProjectUserTabs() {
  const [activeTab, setActiveTab] = useState<TabKey>("project");

  return (
    <div className="admin-tabs-page">
      <div className="admin-tabs">
        <button
          type="button"
          className={`admin-tab${activeTab === "project" ? " is-active" : ""}`}
          onClick={() => setActiveTab("project")}
        >
          Project
        </button>
        <button
          type="button"
          className={`admin-tab${activeTab === "users" ? " is-active" : ""}`}
          onClick={() => setActiveTab("users")}
        >
          User Management
        </button>
      </div>

      <div className="admin-tab-panel">
        {activeTab === "project" ? <AdminProjectsPanel /> : <AdminUsersPanel />}
      </div>
    </div>
  );
}
