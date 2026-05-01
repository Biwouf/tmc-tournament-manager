interface IconProps {
  color?: string;
  size?: number;
  className?: string;
}

export default function EventsIcon({
  color = 'currentColor',
  size = 24,
  className,
}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="4" y="6" width="16" height="14" rx="2" />
      <path d="M4 10h16" />
      <path d="M8.5 4v3.5" />
      <path d="M15.5 4v3.5" />
      <circle cx="15" cy="15" r="2" />
    </svg>
  );
}
