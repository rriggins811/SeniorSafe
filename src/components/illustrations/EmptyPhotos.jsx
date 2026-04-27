export default function EmptyPhotos() {
  return (
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-full">
      <g fill="none" stroke="#1B365D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {/* Photo frame */}
        <rect x="44" y="44" width="112" height="112" rx="6" />
        {/* Inset border to suggest matting */}
        <rect x="56" y="56" width="88" height="88" rx="3" />
        {/* Heart inside frame */}
        <path d="M100 122 C 92 116, 80 110, 80 98 C 80 92, 85 88, 91 88 C 95 88, 99 90, 100 94 C 101 90, 105 88, 109 88 C 115 88, 120 92, 120 98 C 120 110, 108 116, 100 122 Z" />
      </g>
      {/* Gold accent dot at top of heart */}
      <circle cx="100" cy="93" r="2.5" fill="#D4A843" />
      {/* Gold corner accents on frame */}
      <circle cx="50" cy="50" r="1.5" fill="#D4A843" />
      <circle cx="150" cy="150" r="1.5" fill="#D4A843" />
    </svg>
  )
}
