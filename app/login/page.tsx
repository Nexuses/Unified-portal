import type { Metadata } from "next";
import BrevoAuthCard from "../components/BrevoAuthCard";

export const metadata: Metadata = {
  title: "Log in",
  description: "Sign in to Nexuses Unified Portal to manage campaigns, CRM, and analytics.",
};

export default function UserLoginPage() {
  return (
    <BrevoAuthCard
      heading="Welcome back"
      submitLabel="Log In"
      authMode="user"
      redirectTo="/portal"
      formFields={[
        {
          id: "email",
          name: "email",
          label: "Email address",
          type: "email",
          placeholder: "name@example.com",
        },
        {
          id: "password",
          name: "password",
          label: "Password",
          type: "password",
          placeholder: "Enter your password",
        },
      ]}
    />
  );
}
