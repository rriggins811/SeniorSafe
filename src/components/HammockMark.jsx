// The Hammock365 mark as an SVG: two posts, the sagging hammock, the sun (the
// daily tap). Same geometry as Brand_Hammock365/make_brand.py, drawn in a
// 100 x 100 box so it scales cleanly at any size. Replaces the old shield
// icon everywhere in the app (2026-09-12 evergreen re-skin).
//
//   onDark (default): cream hammock, tan posts, gold sun, for the evergreen
//                     headers and tiles.
//   onDark={false}:   evergreen hammock and posts for cream or white
//                     backgrounds.
//   tile:             draws the rounded evergreen square behind the mark,
//                     the same as the app icon.

const EVERGREEN = '#1F5A4B'
const CREAM = '#F4E7CF'
const TAN = '#C8B189'
const SUN = '#F2B544'

export default function HammockMark({ size = 24, onDark = true, tile = false, className = '', style }) {
  const hammock = onDark ? CREAM : EVERGREEN
  const post = onDark ? TAN : EVERGREEN
  const weave = tile || onDark ? EVERGREEN : '#FAF8F4'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {tile && <rect x="0" y="0" width="100" height="100" rx="22" fill={EVERGREEN} />}
      <line x1="24" y1="36" x2="24" y2="80" stroke={post} strokeWidth="7.5" strokeLinecap="round" />
      <line x1="76" y1="36" x2="76" y2="80" stroke={post} strokeWidth="7.5" strokeLinecap="round" />
      <path d="M24 38 Q50 96 76 38" stroke={hammock} strokeWidth="9.5" strokeLinecap="round" />
      <path d="M31 46 Q50 86 69 46" stroke={weave} strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="50" cy="25" r="7.5" fill={SUN} />
    </svg>
  )
}
