"use client";

import { Bell, Check, HelpCircle, Mail, User, X } from "lucide-react";
import {
  EMAIL_STATUS_CATEGORIES,
  EMAIL_STATUS_OPTIONS,
  getEmailStatusCount,
  type EmailStatusIconId,
} from "@/app/components/portal/crm/people/email-status-options";

interface EmailStatusFilterPanelProps {
  value: string[];
  onChange: (values: string[]) => void;
  statusCounts?: Record<string, number>;
}

function StatusBadgeIcon({ icon }: { icon: EmailStatusIconId }) {
  const badgeClass =
    icon === "verified"
      ? "bg-emerald-500 text-white"
      : icon === "update_required"
        ? "bg-amber-500 text-white"
        : icon === "unavailable"
          ? "bg-red-500 text-white"
          : "bg-slate-400 text-white";

  return (
    <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center">
      <Mail className="h-5 w-5 text-slate-400" aria-hidden />
      <span
        className={`absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full ${badgeClass}`}
      >
        {icon === "verified" && <Check className="h-2 w-2" strokeWidth={3} aria-hidden />}
        {icon === "unverified" && <HelpCircle className="h-2 w-2" strokeWidth={2.5} aria-hidden />}
        {icon === "user_managed" && <User className="h-2 w-2" strokeWidth={2.5} aria-hidden />}
        {icon === "update_required" && <Bell className="h-2 w-2" strokeWidth={2.5} aria-hidden />}
        {icon === "unavailable" && <X className="h-2 w-2" strokeWidth={3} aria-hidden />}
        {icon === "catch_all" && <HelpCircle className="h-2 w-2" strokeWidth={2.5} aria-hidden />}
      </span>
    </span>
  );
}

export default function EmailStatusFilterPanel({
  value,
  onChange,
  statusCounts = {},
}: EmailStatusFilterPanelProps) {
  function toggleStatus(optionId: string) {
    const next = value.includes(optionId)
      ? value.filter((entry) => entry !== optionId)
      : [...value, optionId];
    onChange(next);
  }

  return (
    <div className="space-y-3 px-2 pb-3 pt-1">
      {EMAIL_STATUS_CATEGORIES.map((category, categoryIndex) => {
        const options = EMAIL_STATUS_OPTIONS.filter((option) => option.category === category.id);
        if (options.length === 0) return null;

        return (
          <div key={category.id}>
            {categoryIndex > 0 && <div className="mb-3 border-t border-slate-200" />}
            <p className="mb-1.5 text-[11px] font-medium text-slate-500">{category.label}</p>
            <div className="space-y-1">
              {options.map((option) => {
                const checked = value.includes(option.id);
                const count = getEmailStatusCount(option, statusCounts);

                return (
                  <label
                    key={option.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleStatus(option.id)}
                      className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <StatusBadgeIcon icon={option.icon} />
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${option.badgeClass}`}
                    >
                      {option.label}
                    </span>
                    {count > 0 && (
                      <span className="ml-auto text-[11px] text-slate-400">{count}</span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
