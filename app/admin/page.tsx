import type { Metadata } from "next";
import BrevoAuthCard from "../components/BrevoAuthCard";

export const metadata: Metadata = {
  title: "Admin sign in",
  description: "Sign in to the Nexuses Unified Portal admin console.",
};

export default function AdminLoginPage() {
  return (
    <BrevoAuthCard
      heading="Admin sign in"
      submitLabel="Log In"
      authMode="admin"
      redirectTo="/admin/dashboard"
      formFields={[
        {
          id: "admin-email",
          name: "email",
          label: "Email address",
          type: "email",
          placeholder: "admin@example.com",
        },
        {
          id: "admin-password",
          name: "password",
          label: "Password",
          type: "password",
          placeholder: "Enter your password",
        },
      ]}
    />
  );
}
