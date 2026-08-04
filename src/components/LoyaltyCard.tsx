// Vista de la tarjeta de fidelización — imita el pase que se verá en Google Wallet.
// Sirve como preview en la app (y para la demo cuando aún no hay pase real).
import { QRCodeSVG } from "qrcode.react";

function contrastText(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length < 6) return "#ffffff";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#111111" : "#ffffff";
}

export function LoyaltyCard({
  businessName,
  programName,
  rewardDescription,
  stamps,
  stampsRequired,
  brandColor,
  memberName,
  memberId,
  logoUrl,
}: {
  businessName: string;
  programName: string;
  rewardDescription: string;
  stamps: number;
  stampsRequired: number;
  brandColor: string;
  memberName?: string;
  memberId?: string;
  logoUrl?: string | null;
}) {
  const fg = contrastText(brandColor);
  const completed = stamps >= stampsRequired;

  return (
    <div
      className="w-full max-w-sm rounded-2xl p-5 shadow-xl"
      style={{ backgroundColor: brandColor, color: fg }}
    >
      <div className="flex items-center gap-3">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={businessName}
            className="h-10 w-10 rounded-full bg-white/20 object-cover"
          />
        ) : (
          <div
            className="grid h-10 w-10 place-items-center rounded-full bg-white/20 text-lg font-bold"
            aria-hidden
          >
            {businessName.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{businessName}</p>
          <p className="truncate text-xs opacity-80">{programName}</p>
        </div>
      </div>

      {/* Sellos */}
      <div className="mt-5 grid grid-cols-5 gap-2">
        {Array.from({ length: stampsRequired }).map((_, i) => {
          const filled = i < stamps;
          return (
            <div
              key={i}
              className="grid aspect-square place-items-center rounded-full border text-xs font-bold"
              style={{
                borderColor: fg,
                backgroundColor: filled ? fg : "transparent",
                color: filled ? brandColor : fg,
                opacity: filled ? 1 : 0.55,
              }}
            >
              {filled ? "★" : i + 1}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-2xl font-bold leading-none">
            {stamps}
            <span className="text-base font-normal opacity-80">/{stampsRequired}</span>
          </p>
          <p className="mt-1 text-xs opacity-80">
            {completed ? "¡Completa! Reclama tu premio" : "sellos"}
          </p>
        </div>
        {memberId ? (
          <div className="rounded-lg bg-white p-1.5">
            <QRCodeSVG value={memberId} size={64} />
          </div>
        ) : null}
      </div>

      <div className="mt-4 rounded-lg bg-black/15 px-3 py-2 text-xs">
        <span className="opacity-80">Premio: </span>
        {rewardDescription}
      </div>

      {memberName ? <p className="mt-3 text-xs opacity-80">Titular: {memberName}</p> : null}
    </div>
  );
}
