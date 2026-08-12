"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const LOGO_URL =
  "https://cdn-nexlink.s3.us-east-2.amazonaws.com/Nexuses-full-logo-dark_8d412ea3-bf11-4fc6-af9c-bee7e51ef494.png";

type BrevoAuthCardProps = {
  heading: string;
  submitLabel: string;
  formFields: Array<{
    id: string;
    name: string;
    label: string;
    type: "email" | "password" | "text";
    placeholder: string;
  }>;
  helperText?: string;
  redirectTo?: string;
  authMode?: "user" | "admin";
};

export default function BrevoAuthCard({
  heading,
  submitLabel,
  formFields,
  helperText,
  redirectTo,
  authMode = "admin",
}: BrevoAuthCardProps) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    setLoading(true);
    try {
      const endpoint =
        authMode === "admin" ? "/api/auth/admin-login" : "/api/auth/login";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Invalid email or password");
      }

      router.push(
        redirectTo || (authMode === "admin" ? "/admin/dashboard" : "/portal"),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-screen">
      <main className="auth-shell">
        <div className="auth-brand">
          <Image
            src={LOGO_URL}
            alt="Nexuses"
            width={220}
            height={56}
            className="auth-brand-logo"
            priority
            unoptimized
          />
        </div>

        <section className="auth-card">
          <h2 className="auth-title">{heading}</h2>

          <form className="auth-form" onSubmit={handleSubmit}>
            {formFields.map((field) => (
              <label key={field.id} htmlFor={field.id} className="auth-field-wrap">
                <span className="auth-label">
                  {field.label} <strong>*</strong>
                </span>
                <input
                  id={field.id}
                  name={field.name}
                  type={field.type}
                  placeholder={field.placeholder}
                  className="auth-input"
                  required
                  autoComplete={
                    field.type === "password" ? "current-password" : "email"
                  }
                />
              </label>
            ))}

            {helperText ? <p className="auth-helper">{helperText}</p> : null}
            {error ? <p className="auth-error">{error}</p> : null}

            <button type="submit" className="auth-submit" disabled={loading}>
              {loading ? "Signing in..." : submitLabel}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
