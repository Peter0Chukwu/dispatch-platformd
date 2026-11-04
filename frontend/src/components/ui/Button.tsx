import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand-900 text-white hover:bg-brand-800 active:bg-brand-950 disabled:bg-brand-300',
  accent: 'bg-accent-600 text-white hover:bg-accent-700 active:bg-accent-800 disabled:bg-accent-200',
  secondary: 'bg-white text-ink-800 border border-ink-300 hover:bg-ink-50 active:bg-ink-100 disabled:text-ink-400',
  ghost: 'bg-transparent text-ink-700 hover:bg-ink-100 active:bg-ink-200 disabled:text-ink-400',
  danger: 'bg-danger-600 text-white hover:bg-danger-700 active:bg-danger-700 disabled:bg-danger-200',
  link: 'bg-transparent text-brand-600 underline-offset-4 hover:underline p-0 h-auto',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-11 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-base gap-2 rounded-xl',
};

/**
 * Primary action element. Enforces a 44px touch target on medium/large sizes
 * (see .touch-target) and always renders a busy state instead of letting a user
 * double-submit a payment or a delivery acceptance.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', isLoading = false, fullWidth, leftIcon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={cn(
        'inline-flex items-center justify-center font-semibold transition-colors',
        'disabled:cursor-not-allowed',
        VARIANTS[variant],
        variant !== 'link' && SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {isLoading ? <Spinner size="sm" className={variant === 'secondary' || variant === 'ghost' ? 'text-ink-500' : 'text-white'} /> : leftIcon}
      {children}
    </button>
  );
});
