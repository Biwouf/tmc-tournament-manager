interface IconProps {
  color?: string;
  size?: number;
  className?: string;
}

export default function ActusIcon({
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
      <path d="M5 6.5a1.5 1.5 0 0 1 1.5-1.5h11a1.5 1.5 0 0 1 1.5 1.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 17.5v-11Z" />
      <path d="M8 8.5h8" />
      <path d="M8 11h8" />
      <path d="M8 13.5h5" />
      <path d="M8 16h4" />
    </svg>
  );
}
