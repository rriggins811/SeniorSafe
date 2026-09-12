// Maggie's mark: a sun-gold disc with the Hammock365 hammock in evergreen
// (2026-09-12 re-skin; it was a navy shield monogram before). Inline SVG so
// it scales anywhere without an asset upload. Same geometry as HammockMark,
// scaled into the disc; the sun becomes a cream dot so it reads on gold.
export default function AIMark({ size = 36 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="18" cy="18" r="17" fill="#F2B544" />
      <g transform="translate(8 8) scale(0.2)">
        <line x1="24" y1="36" x2="24" y2="80" stroke="#1F5A4B" strokeWidth="9" strokeLinecap="round" />
        <line x1="76" y1="36" x2="76" y2="80" stroke="#1F5A4B" strokeWidth="9" strokeLinecap="round" />
        <path d="M24 38 Q50 96 76 38" fill="none" stroke="#1F5A4B" strokeWidth="11" strokeLinecap="round" />
        <circle cx="50" cy="25" r="8" fill="#F4E7CF" />
      </g>
    </svg>
  )
}
