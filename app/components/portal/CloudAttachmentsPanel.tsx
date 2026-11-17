"use client";

import { useRef, useState } from "react";
import type { CloudCampaign } from "@/lib/cloud-campaigns";

const MAX_TOTAL = 18 * 1024 * 1024;

function size(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

type Props = {
  campaign: CloudCampaign;
  disabled: boolean;
  onChange: (campaign: CloudCampaign) => void;
  onError: (message: string) => void;
};

/** Files attached to every email in the campaign. */
export default function CloudAttachmentsPanel({ campaign, disabled, onChange, onError }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [working, setWorking] = useState(false);
  const files = campaign.attachments || [];
  const total = files.reduce((sum, f) => sum + f.size, 0);
  const locked = disabled || campaign.status === "sending";

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    const chosen = Array.from(list);
    if (total + chosen.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL) {
      onError("Attachments can total up to 18 MB per email.");
      return;
    }
    setWorking(true);
    try {
      const form = new FormData();
      chosen.forEach((file) => form.append("files", file));
      const response = await fetch(`/api/cloud-campaigns/${encodeURIComponent(campaign.id)}/attachments`, {
        method: "POST",
        body: form,
      });
      const data = (await response.json().catch(() => null)) as { campaign?: CloudCampaign; error?: string } | null;
      if (!response.ok || !data?.campaign) throw new Error(data?.error || "Could not add the attachment");
      onChange(data.campaign);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not add the attachment");
    } finally {
      setWorking(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(id: string) {
    setWorking(true);
    try {
      const response = await fetch(
        `/api/cloud-campaigns/${encodeURIComponent(campaign.id)}/attachments?attachmentId=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      const data = (await response.json().catch(() => null)) as { campaign?: CloudCampaign; error?: string } | null;
      if (!response.ok || !data?.campaign) throw new Error(data?.error || "Could not remove the attachment");
      onChange(data.campaign);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not remove the attachment");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="cloud-attachments">
      <div className="cloud-attachments-head">
        <strong>Attachments</strong>
        <small>
          {files.length ? `${files.length} file${files.length === 1 ? "" : "s"} · ${size(total)} of 18 MB` : "Optional · sent with every email"}
        </small>
      </div>
      {files.length ? (
        <ul>
          {files.map((file) => (
            <li key={file.id}>
              <span className="cloud-attachments-name">{file.name}</span>
              <small>{size(file.size)}</small>
              <button type="button" className="cloud-link-btn" disabled={locked || working} onClick={() => void remove(file.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => void upload(event.target.files)}
        />
        <button
          type="button"
          className="btn-soft btn-sm"
          disabled={locked || working}
          onClick={() => inputRef.current?.click()}
        >
          {working ? "Uploading…" : "Add files"}
        </button>
      </div>
    </div>
  );
}
