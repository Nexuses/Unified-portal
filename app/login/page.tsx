import BrevoAuthCard from "../components/BrevoAuthCard";

export default function UserLoginPage() {
  return (
    <BrevoAuthCard
      heading="Log In"
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
