"use client";

import { useId, useState } from "react";
import { ButtonLoadingContent } from "@/components/button-loader";
import {
  canPreviewImage,
  isHttpImageUrl,
  isLegacyEmbeddedImage,
} from "@/lib/image-field";

type ImageUploadFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  kind: "header" | "banner" | "company";
  inputClass?: string;
};

export function ImageUploadField({
  label,
  value,
  onChange,
  kind,
  inputClass = "mt-2 h-11 w-full rounded-xl border border-black/10 bg-[#fafaf8] px-3 text-sm text-black outline-none transition focus:border-black/30 focus:bg-white",
}: ImageUploadFieldProps) {
  const fileId = useId();
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");

  const trimmed = value.trim();
  const hasImage = trimmed.length > 0;
  const legacyEmbedded = isLegacyEmbeddedImage(trimmed);
  const showPreview = hasImage && canPreviewImage(trimmed);
  const urlInputValue = isHttpImageUrl(trimmed) ? trimmed : "";

  async function handleFile(file: File | undefined) {
    if (!file) {
      return;
    }
    setIsUploading(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("kind", kind);
      const response = await fetch("/api/uploads/image", {
        method: "POST",
        body,
      });
      const payload = (await response.json()) as { url?: string; message?: string };
      if (!response.ok || !payload.url) {
        throw new Error(payload.message ?? "Failed to upload image.");
      }
      onChange(payload.url);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Failed to upload image.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-black">{label}</p>

      {hasImage ? (
        <div className="relative inline-flex max-w-full">
          {legacyEmbedded ? (
            <div className="flex max-w-sm items-start gap-3 rounded-xl border border-amber-200/80 bg-amber-50/80 px-3 py-3 pr-10">
              <span
                className="mt-0.5 flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-amber-200/60 bg-white text-[10px] font-semibold tracking-wide text-amber-800/70 uppercase"
                aria-hidden
              >
                Legacy
              </span>
              <div>
                <p className="text-sm font-medium text-amber-950">Old embedded image</p>
                <p className="mt-1 text-xs leading-relaxed text-amber-900/75">
                  Remove it with ×, then upload a new image.
                </p>
              </div>
            </div>
          ) : showPreview ? (
            // eslint-disable-next-line @next/next/no-img-element -- user-provided S3 image URLs
            <img
              src={trimmed}
              alt=""
              className="max-h-28 max-w-full rounded-xl border border-black/10 object-cover"
            />
          ) : null}
          <button
            type="button"
            onClick={() => {
              setError("");
              onChange("");
            }}
            className="absolute -top-2 -right-2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-black/15 bg-white text-base leading-none text-black/70 shadow-sm hover:bg-red-50 hover:text-red-600"
            aria-label={`Remove ${label}`}
            title="Remove image"
          >
            ×
          </button>
        </div>
      ) : null}

      <div>
        <input
          id={fileId}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="sr-only"
          disabled={isUploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            void handleFile(file);
          }}
        />
        <label
          htmlFor={fileId}
          className={`inline-flex h-11 cursor-pointer items-center justify-center rounded-xl border border-black/10 bg-white px-4 text-sm font-medium text-black transition hover:border-black/25 hover:bg-[#fafaf8] ${
            isUploading ? "pointer-events-none opacity-60" : ""
          }`}
        >
          <ButtonLoadingContent loading={isUploading} loadingText="Uploading...">
            {hasImage ? "Replace image" : "Upload image"}
          </ButtonLoadingContent>
        </label>
        <p className="mt-1.5 text-xs text-black/50">
          PNG, JPG, WEBP, or GIF up to 5 MB. The file is stored in S3 and only the link is saved.
        </p>
      </div>

      {urlInputValue ? (
        <label className="block">
          <span className="text-sm text-black/70">S3 link</span>
          <input
            type="text"
            readOnly
            className={inputClass}
            value={urlInputValue}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
      ) : null}

      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
