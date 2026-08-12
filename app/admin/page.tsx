import BrevoAuthCard from "../components/BrevoAuthCard";

export default function AdminLoginPage() {
  return (
    <BrevoAuthCard
      heading="Log In"
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
          placeholder: "Enter admin password",
        },
      ]}
    />
  );
}
