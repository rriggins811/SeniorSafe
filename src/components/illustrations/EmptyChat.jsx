export default function EmptyChat() {
  return (
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-full">
      <g fill="none" stroke="#1B365D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {/* Top-left bubble */}
        <path d="M48 56 Q48 48 56 48 L96 48 Q104 48 104 56 L104 76 Q104 84 96 84 L66 84 L58 92 L60 84 L56 84 Q48 84 48 76 Z" />
        {/* Right bubble */}
        <path d="M110 88 Q110 80 118 80 L156 80 Q164 80 164 88 L164 108 Q164 116 156 116 L138 116 L132 124 L132 116 L118 116 Q110 116 110 108 Z" />
        {/* Bottom-left bubble */}
        <path d="M52 116 Q52 108 60 108 L108 108 Q116 108 116 116 L116 138 Q116 146 108 146 L80 146 L72 154 L74 146 L60 146 Q52 146 52 138 Z" />
      </g>
      {/* Gold accent dots inside bubbles */}
      <circle cx="76" cy="66" r="2.5" fill="#D4A843" />
      <circle cx="137" cy="98" r="2.5" fill="#D4A843" />
      <circle cx="84" cy="127" r="2.5" fill="#D4A843" />
    </svg>
  )
}
