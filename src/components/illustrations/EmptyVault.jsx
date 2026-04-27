export default function EmptyVault() {
  return (
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-full">
      <g fill="none" stroke="#1B365D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {/* Folder tab */}
        <path d="M40 70 L40 60 Q40 54 46 54 L82 54 L92 64 L154 64 Q160 64 160 70" />
        {/* Folder body */}
        <rect x="40" y="64" width="120" height="84" rx="6" />
        {/* Inner divider line */}
        <line x1="40" y1="84" x2="160" y2="84" />
        {/* Lock body */}
        <rect x="92" y="108" width="16" height="16" rx="3" />
        {/* Lock shackle */}
        <path d="M95 108 L95 102 Q95 96 100 96 Q105 96 105 102 L105 108" />
      </g>
      {/* Gold accent dot in lock keyhole */}
      <circle cx="100" cy="116" r="2" fill="#D4A843" />
    </svg>
  )
}
