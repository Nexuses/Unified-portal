import type { PeopleLookalikeSuggestion } from "@/app/components/portal/crm/people/people-lookalike-suggestions";

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

function HyundaiLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
      <ellipse cx="12" cy="12" rx="10" ry="7" fill="none" stroke="white" strokeWidth="1.5" />
      <text
        x="12"
        y="15"
        textAnchor="middle"
        fill="white"
        fontSize="9"
        fontStyle="italic"
        fontWeight="700"
        fontFamily="Arial, sans-serif"
      >
        H
      </text>
    </svg>
  );
}

function BlackRockLogo() {
  return (
    <span className="text-[7px] font-bold uppercase tracking-[0.12em] text-white">BlackRock</span>
  );
}

function NextPlayLogo() {
  return (
    <span className="text-[8px] font-semibold leading-none text-white">
      Next
      <br />
      Play.
    </span>
  );
}

function MorstarLogo() {
  return (
    <span className="text-[7px] font-bold uppercase tracking-wide text-blue-700">Morstar</span>
  );
}

function ChinaLogo() {
  return (
    <span className="text-center text-[8px] font-bold leading-tight text-white">
      CHINA
      <span className="mt-0.5 block text-[6px] font-normal">中国</span>
    </span>
  );
}

function VantageLogo() {
  return (
    <span className="font-serif text-lg italic leading-none text-white">V</span>
  );
}

function IntelligramLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
      <path
        d="M12 3c-1 4-4 6-4 9a4 4 0 0 0 8 0c0-3-3-5-4-9Z"
        fill="none"
        stroke="#10b981"
        strokeWidth="1.6"
      />
      <path
        d="M10 14c1.5 1 3 1.5 4 1"
        fill="none"
        stroke="#10b981"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BreakthroughLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
      <circle cx="12" cy="12" r="8" fill="none" stroke="#111827" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="2.5" fill="#111827" />
      <path d="M12 4v3M12 17v3M4 12h3M17 12h3" stroke="#111827" strokeWidth="1.5" />
    </svg>
  );
}

function NovaTasteLogo() {
  return <span className="text-[8px] font-bold leading-none text-orange-700">NT</span>;
}

const LOGO_BACKGROUNDS: Record<string, string> = {
  "mike-braham": "bg-white ring-1 ring-slate-200",
  "bill-gates": "bg-lime-400",
  "bobby-purnama": "bg-blue-700",
  "christian-luedders": "bg-orange-50 ring-1 ring-orange-200",
  "yunming-shao": "bg-red-700",
  "larry-fink": "bg-black",
  "crawford-how": "bg-rose-900",
  "satya-nadella": "bg-white ring-1 ring-slate-200",
  "jeff-weiner": "bg-blue-950",
  "susanna-su": "bg-white ring-1 ring-slate-200",
};

function LogoContent({ id }: { id: string }) {
  switch (id) {
    case "mike-braham":
      return <IntelligramLogo />;
    case "bill-gates":
      return <BreakthroughLogo />;
    case "bobby-purnama":
      return <HyundaiLogo />;
    case "christian-luedders":
      return <NovaTasteLogo />;
    case "yunming-shao":
      return <ChinaLogo />;
    case "larry-fink":
      return <BlackRockLogo />;
    case "crawford-how":
      return <VantageLogo />;
    case "satya-nadella":
      return <MicrosoftLogo />;
    case "jeff-weiner":
      return <NextPlayLogo />;
    case "susanna-su":
      return <MorstarLogo />;
    default:
      return null;
  }
}

export default function PeopleLookalikeAvatar({
  person,
}: {
  person: PeopleLookalikeSuggestion;
}) {
  const logoId = person.logoId;
  const hasCustomLogo = Boolean(logoId && LOGO_BACKGROUNDS[logoId]);

  return (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md ${
        hasCustomLogo ? LOGO_BACKGROUNDS[logoId!] : person.avatarClassName
      }`}
    >
      {hasCustomLogo ? (
        <LogoContent id={logoId!} />
      ) : (
        <span className="text-[10px] font-semibold">{person.avatarLabel}</span>
      )}
    </span>
  );
}
