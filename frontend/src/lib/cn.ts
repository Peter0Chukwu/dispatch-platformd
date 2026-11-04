/** Tiny class-name joiner. Avoids pulling in clsx for one function. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
