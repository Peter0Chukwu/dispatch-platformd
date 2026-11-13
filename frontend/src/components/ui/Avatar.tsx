import { cn } from '../../lib/cn';
import { useBlobUrl } from '../../lib/useBlobUrl';

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * A user's picture, or their initials.
 *
 * The picture is private, so it is fetched with the session token (see useBlobUrl)
 * rather than pointed at directly. While it loads, and whenever there is no picture
 * at all, the initials stand in — which is why "no avatar" is a complete state and
 * not a hole in the layout.
 */
export function Avatar({
  name,
  src,
  size = 'md',
  className,
}: {
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const dimensions = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-14 w-14 text-base' }[size];
  const { url } = useBlobUrl(src);

  if (url) {
    return (
      <img
        src={url}
        alt={name}
        className={cn('shrink-0 rounded-full object-cover ring-2 ring-white', dimensions, className)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      title={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-brand-900 font-semibold text-white',
        dimensions,
        className,
      )}
    >
      {initials(name) || '?'}
    </span>
  );
}
