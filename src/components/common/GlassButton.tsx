import type { ButtonHTMLAttributes, ReactNode } from 'react';

type GlassButtonTint =
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'neutral';

type GlassButtonVariant = 'solid' | 'outline' | 'ghost';

type GlassButtonSize = 'xs' | 'sm' | 'md' | 'lg';

type GlassButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tint?: GlassButtonTint;
  variant?: GlassButtonVariant;
  size?: GlassButtonSize;
  square?: boolean;
  loading?: boolean;
  loadingText?: ReactNode;
  className?: string;
};

const BASE_CLASSES =
  'btn border-base-content/20 bg-base-100/35 backdrop-blur-md shadow-lg hover:bg-base-100/50';

const SIZE_CLASSES: Record<GlassButtonSize, string> = {
  xs: 'btn-xs',
  sm: 'btn-sm',
  md: '',
  lg: 'btn-lg',
};

const VARIANT_TINT_CLASSES: Record<GlassButtonVariant, Record<GlassButtonTint, string>> = {
  solid: {
    primary: 'border-primary/50 bg-primary/30 text-primary-content hover:bg-primary/40',
    secondary: 'border-secondary/50 bg-secondary/30 text-secondary-content hover:bg-secondary/40',
    accent: 'border-accent/50 bg-accent/30 text-accent-content hover:bg-accent/40',
    info: 'border-info/50 bg-info/30 text-info-content hover:bg-info/40',
    success: 'border-success/50 bg-success/30 text-success-content hover:bg-success/40',
    warning: 'border-warning/50 bg-warning/30 text-warning-content hover:bg-warning/40',
    error: 'border-error/50 bg-error/30 text-error-content hover:bg-error/40',
    neutral: 'border-neutral/50 bg-neutral/30 text-neutral-content hover:bg-neutral/40',
  },
  outline: {
    primary: 'border-primary/50 bg-base-100/20 text-primary hover:bg-primary/15',
    secondary: 'border-secondary/50 bg-base-100/20 text-secondary hover:bg-secondary/15',
    accent: 'border-accent/50 bg-base-100/20 text-accent hover:bg-accent/15',
    info: 'border-info/50 bg-base-100/20 text-info hover:bg-info/15',
    success: 'border-success/50 bg-base-100/20 text-success hover:bg-success/15',
    warning: 'border-warning/50 bg-base-100/20 text-warning hover:bg-warning/15',
    error: 'border-error/50 bg-base-100/20 text-error hover:bg-error/15',
    neutral: 'border-base-content/30 bg-base-100/20 text-base-content hover:bg-base-100/35',
  },
  ghost: {
    primary: 'border-transparent bg-base-100/10 text-primary hover:bg-base-100/25',
    secondary: 'border-transparent bg-base-100/10 text-secondary hover:bg-base-100/25',
    accent: 'border-transparent bg-base-100/10 text-accent hover:bg-base-100/25',
    info: 'border-transparent bg-base-100/10 text-info hover:bg-base-100/25',
    success: 'border-transparent bg-base-100/10 text-success hover:bg-base-100/25',
    warning: 'border-transparent bg-base-100/10 text-warning hover:bg-base-100/25',
    error: 'border-transparent bg-base-100/10 text-error hover:bg-base-100/25',
    neutral: 'border-transparent bg-base-100/10 text-base-content hover:bg-base-100/25',
  },
};

export default function GlassButton({
  tint = 'neutral',
  variant = 'solid',
  size = 'md',
  square = false,
  loading = false,
  loadingText,
  className,
  children,
  disabled,
  ...props
}: GlassButtonProps) {
  const isDisabled = Boolean(disabled || loading);
  const content = loading && loadingText ? loadingText : children;

  return (
    <button
      className={`${BASE_CLASSES} ${SIZE_CLASSES[size]} ${VARIANT_TINT_CLASSES[variant][tint]}${square ? ' btn-square' : ''}${className ? ` ${className}` : ''}`}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <span className="loading loading-spinner loading-xs" aria-hidden="true" />}
      {content}
    </button>
  );
}
