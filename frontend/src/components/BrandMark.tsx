/**
 * THE BRAND MARK.
 *
 * One component, so the logo cannot drift between the sidebar, the drawer, the
 * sign-in screen and the landing page — which is exactly what happened while it
 * was an inline SVG copy-pasted into three files.
 *
 * The artwork is a full-colour illustration (dark outlines, white highlights),
 * so it is drawn on a white tile rather than knocked out to a single colour: on
 * a dark panel, white-on-white would vanish, and a flat one-colour version of
 * this mark would lose the truck entirely. The tile keeps the mark legible on
 * both the white rail and the near-black sign-in panel.
 *
 * `alt` is empty on purpose: the product name is always printed beside it, and a
 * screen reader announcing "Traders Welfare Logistics logo, Traders Welfare
 * Logistics" is noise. The wrapping link or heading carries the name.
 */
export function BrandMark({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const tile = {
    sm: 'h-9 w-9 rounded-lg p-1',
    md: 'h-10 w-10 rounded-xl p-1.5',
    lg: 'h-12 w-12 rounded-xl p-1.5',
  }[size];

  return (
    <span
      className={[
        'inline-flex shrink-0 items-center justify-center bg-white ring-1 ring-ink-200',
        tile,
        className ?? '',
      ].join(' ')}
    >
      <img
        src="/brand/logo-mark.webp"
        alt=""
        aria-hidden="true"
        width={385}
        height={266}
        className="h-auto w-full object-contain"
        draggable={false}
      />
    </span>
  );
}
