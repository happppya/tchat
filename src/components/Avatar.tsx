interface Props {
  name: string;
  src?: string | null;
  size?: number;
}

/**
 * A square avatar: renders the profile picture when present, otherwise the
 * first letter of the name as a terminal-styled fallback.
 */
export default function Avatar({ name, src, size = 24 }: Props) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();

  return (
    <span
      className="inline-flex items-center justify-center rounded-sm overflow-hidden flex-shrink-0 border border-[var(--border-primary)] bg-[var(--bg-tertiary)] text-[var(--accent)] font-semibold leading-none select-none"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, Math.floor(size * 0.45)),
      }}
    >
      {src ? (
        <img
          data-testid="avatar-image"
          src={src}
          alt={name}
          className="w-full h-full object-cover"
        />
      ) : (
        <span>{initial}</span>
      )}
    </span>
  );
}
