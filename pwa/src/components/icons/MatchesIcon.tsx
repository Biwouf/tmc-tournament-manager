interface IconProps {
  color?: string;
  size?: number;
  className?: string;
}

export default function MatchesIcon({
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
      <ellipse cx="8.2" cy="8.2" rx="3.4" ry="3.4" />
      <path d="M10.6 10.6 14.5 14.5" />
      <path d="m14 14 1.6 1.6" strokeWidth={2.2} />
      <ellipse cx="15.8" cy="8.2" rx="3.4" ry="3.4" />
      <path d="M13.4 10.6 9.5 14.5" />
      <path d="m10 14-1.6 1.6" strokeWidth={2.2} />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}
