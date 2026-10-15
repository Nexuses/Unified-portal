function GoogleLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.7-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1C3.4 21.3 7.4 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.4 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3V6.6H1.4C.5 8.2 0 10 0 12s.5 3.8 1.4 5.4l4-3.1Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0 7.4 0 3.4 2.7 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z"
      />
    </svg>
  );
}

function AmazonLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path
        fill="#fff"
        d="M18.4 16.7c-2 1.5-4.9 2.3-7.4 2.3-3.5 0-6.6-1.3-9-3.4-.2-.2 0-.4.2-.3 2.6 1.5 5.7 2.4 9 2.4 2.2 0 4.6-.5 6.8-1.4.3-.1.6.2.4.4Z"
      />
      <path
        fill="#fff"
        d="M19.2 15.8c-.3-.3-1.7-.2-2.4-.1-.2 0-.2-.2 0-.3 1.1-.8 2.9-.5 3.1-.3.2.3 0 2-1.1 2.9-.1.1-.3 0-.2-.1.3-.6.8-1.7.6-2Z"
      />
      <text x="12" y="13" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="700" fontFamily="Arial">a</text>
    </svg>
  );
}

function LinkedInLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="#fff" d="M4.98 3.5A2.5 2.5 0 1 0 5 8.5a2.5 2.5 0 0 0 0-5ZM3 9h4v12H3zM9 9h3.8v1.7h.1c.5-1 1.8-2 3.7-2 4 0 4.7 2.6 4.7 6V21h-4v-5.3c0-1.3 0-2.9-1.8-2.9s-2 1.4-2 2.8V21H9z" />
    </svg>
  );
}

function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
      <rect x="1" y="1" width="6" height="6" fill="#f25022" />
      <rect x="9" y="1" width="6" height="6" fill="#7fba00" />
      <rect x="1" y="9" width="6" height="6" fill="#00a4ef" />
      <rect x="9" y="9" width="6" height="6" fill="#ffb900" />
    </svg>
  );
}

function TedLogo() {
  return <span className="text-[9px] font-black tracking-tight text-white">TED</span>;
}

function DeloitteLogo() {
  return (
    <span className="text-[10px] font-bold text-white">
      D<span className="text-green-400">.</span>
    </span>
  );
}

function UnileverLogo() {
  return <span className="text-[11px] font-serif font-bold text-white">U</span>;
}

function IbmLogo() {
  return <span className="text-[8px] font-black tracking-tight text-[#1f70c1]">IBM</span>;
}

function TcsLogo() {
  return <span className="text-[7px] font-bold uppercase tracking-tight text-slate-700">TCS</span>;
}

function AppleLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path
        fill="#fff"
        d="M16.4 12.6c0-2 1.6-2.9 1.7-3-1-1.4-2.4-1.6-2.9-1.6-1.2-.1-2.4.7-3 .7s-1.6-.7-2.6-.7c-1.3 0-2.6.8-3.3 2-1.4 2.4-.4 6 1 8 .7.9 1.4 2 2.5 1.9 1-.04 1.4-.6 2.6-.6s1.5.6 2.6.6 1.7-.9 2.4-1.8c.7-1 1-2 1-2-.1 0-2-.8-2-3Z"
      />
      <path fill="#fff" d="M14.6 6.3c.5-.7.9-1.6.8-2.5-.8 0-1.7.5-2.3 1.2-.5.6-.9 1.5-.8 2.4.9.1 1.8-.4 2.3-1.1Z" />
    </svg>
  );
}

const LOGO_BACKGROUNDS: Record<string, string> = {
  google: "bg-white ring-1 ring-slate-200",
  amazon: "bg-[#ff9900]",
  linkedin: "bg-[#0a66c2]",
  microsoft: "bg-white ring-1 ring-slate-200",
  ted: "bg-[#e62b1e]",
  deloitte: "bg-black",
  unilever: "bg-[#1f36c7]",
  ibm: "bg-white ring-1 ring-slate-200",
  tcs: "bg-white ring-1 ring-slate-200",
  apple: "bg-black",
};

function LogoContent({ id }: { id: string }) {
  switch (id) {
    case "google":
      return <GoogleLogo />;
    case "amazon":
      return <AmazonLogo />;
    case "linkedin":
      return <LinkedInLogo />;
    case "microsoft":
      return <MicrosoftLogo />;
    case "ted":
      return <TedLogo />;
    case "deloitte":
      return <DeloitteLogo />;
    case "unilever":
      return <UnileverLogo />;
    case "ibm":
      return <IbmLogo />;
    case "tcs":
      return <TcsLogo />;
    case "apple":
      return <AppleLogo />;
    default:
      return null;
  }
}

export default function CompanyAvatar({
  suggestionId,
  name,
}: {
  suggestionId?: string;
  name: string;
}) {
  const hasLogo = Boolean(suggestionId && LOGO_BACKGROUNDS[suggestionId]);
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md ${
        hasLogo
          ? LOGO_BACKGROUNDS[suggestionId!]
          : "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
      }`}
    >
      {hasLogo ? (
        <LogoContent id={suggestionId!} />
      ) : (
        <span className="text-[11px] font-semibold">{initial}</span>
      )}
    </span>
  );
}
