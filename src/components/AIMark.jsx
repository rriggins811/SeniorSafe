// SeniorSafe AI mark: gold disc with a small navy shield monogram inside.
// Inline SVG so we can update without re-uploading assets. Compass AI
// (Build 26+) will get its own sibling component, not a refactor of this.
export default function AIMark({ size = 36 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="18" cy="18" r="17" fill="#D4A843" />
      <path
        d="M18 9 L25 12 L25 19 C25 23 22 26 18 27.5 C14 26 11 23 11 19 L11 12 Z"
        fill="#1B365D"
      />
      <path
        d="M14.8 18 L17 20.2 L21.4 15.8"
        stroke="#D4A843"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
