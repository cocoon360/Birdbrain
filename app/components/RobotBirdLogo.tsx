'use client';

/**
 * Inline mark so logos work in the Tauri sidecar and any environment where
 * absolute `/icons/…` requests are flaky. Matches `public/icons/robot-bird-transparent.svg`.
 */
export function RobotBirdLogo({ size = 36 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      aria-hidden
      style={{ display: 'block', flexShrink: 0 }}
    >
      <path
        d="M12 38c4-10 14-18 26-18l8-6 2 8-6 4c2 4 3 8 3 12H12z"
        stroke="#2a2a2a"
        strokeWidth={1.5}
        fill="#111111"
        fillOpacity={0.92}
      />
      <path
        d="M38 20l10-8 3 11-9 5"
        stroke="#00b4d8"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="#0d0d0d"
        fillOpacity={0.92}
      />
      <circle cx={28} cy={26} r={5} stroke="#00b4d8" strokeWidth={2} fill="#0a0a0a" />
      <circle cx={29} cy={25} r={1.5} fill="#00b4d8" />
      <path
        d="M34 26h10l-4 4-6-1"
        stroke="#e8e8e8"
        strokeWidth={2}
        strokeLinejoin="round"
        fill="#151515"
        fillOpacity={0.95}
      />
      <path d="M18 40h22" stroke="#444" strokeWidth={1.5} strokeLinecap="round" />
      <path d="M22 44h14" stroke="#333" strokeWidth={1.5} strokeLinecap="round" />
      <path
        d="M44 22v-6M44 16l3-3M44 16l-3-3"
        stroke="#00b4d8"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <path
        d="M14 34l-4 2M12 30l-5 1M15 28l-4-3"
        stroke="#666"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
    </svg>
  );
}
