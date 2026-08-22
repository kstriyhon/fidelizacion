// Badges estilo "Add to Apple/Google Wallet" oficiales — pill negra, ícono de
// tarjeta a la izquierda, texto en dos líneas (chico "Añadir a" / grande
// "Apple Wallet" o "Google Wallet"). Recreados en SVG inline (sin dependencia
// de assets externos) siguiendo el layout de los badges oficiales.

function AppleWalletIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="2" y="6" width="26" height="18" rx="3.5" fill="#F5F1E8" />
      <rect x="2" y="6" width="26" height="18" rx="3.5" stroke="#D8D0BE" strokeWidth="0.5" />
      <rect x="2" y="17.5" width="26" height="3.5" fill="url(#appleStripe)" />
      <defs>
        <linearGradient id="appleStripe" x1="2" y1="0" x2="28" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#F5A623" />
          <stop offset="0.25" stopColor="#F55A5A" />
          <stop offset="0.5" stopColor="#D45AC0" />
          <stop offset="0.75" stopColor="#5AA9F5" />
          <stop offset="1" stopColor="#5AD48F" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function GoogleWalletIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="2" y="6" width="26" height="18" rx="3.5" fill="#4285F4" />
      <path d="M2 15.5L14 6h6L10 15.5H2Z" fill="#FBBC05" />
      <path d="M28 14.5L16 24h-6l10-9.5h8Z" fill="#34A853" />
    </svg>
  );
}

function WalletBadge({
  href,
  variant,
  disabled,
}: {
  href: string | null;
  variant: "apple" | "google";
  disabled?: boolean;
}) {
  const label = variant === "apple" ? "Apple Wallet" : "Google Wallet";
  const content = (
    <span
      className={`flex w-full items-center gap-3 rounded-full bg-black px-5 py-2.5 text-white transition-opacity ${
        disabled ? "cursor-not-allowed opacity-50" : "hover:opacity-90"
      }`}
    >
      {variant === "apple" ? <AppleWalletIcon /> : <GoogleWalletIcon />}
      <span className="flex flex-col leading-tight">
        <span className="text-[11px] font-normal text-white/90">Añadir a</span>
        <span className="text-base font-semibold">{label}</span>
      </span>
    </span>
  );

  if (disabled || !href) {
    return <div className="block w-full">{content}</div>;
  }

  return (
    <a href={href} target="_blank" rel="noreferrer" className="block w-full">
      {content}
    </a>
  );
}

export function AppleWalletBadge({ href }: { href: string | null }) {
  return <WalletBadge href={href} variant="apple" />;
}

export function GoogleWalletBadge({ href }: { href: string | null }) {
  return <WalletBadge href={href} variant="google" />;
}
