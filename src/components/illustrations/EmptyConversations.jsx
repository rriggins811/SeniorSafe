export default function EmptyConversations() {
  return (
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-full">
      <g fill="none" stroke="#1B365D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {/* Single rounded chat bubble with tail */}
        <path d="M52 64 Q52 52 64 52 L136 52 Q148 52 148 64 L148 116 Q148 128 136 128 L92 128 L78 144 L82 128 L64 128 Q52 128 52 116 Z" />
      </g>
      {/* Gold dot inside the bubble */}
      <circle cx="100" cy="90" r="5" fill="#D4A843" />
    </svg>
  )
}
