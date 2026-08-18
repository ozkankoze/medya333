import * as React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        // h-12: mobil dokunma hedefi
        'flex h-12 w-full rounded-[--radius-control] border bg-white px-3.5 text-body text-ink-900',
        'placeholder:text-ink-400',
        'transition-[border-color,box-shadow] duration-[--duration-fast] ease-[--ease-out-soft]',
        'focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500',
        'disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-400',
        invalid ? 'border-danger-600 focus:border-danger-600 focus:ring-danger-600' : 'border-ink-200',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export const Label = ({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
  <label className={cn('block text-small font-medium text-ink-800', className)} {...props} />
)

export const FieldHint = ({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn('text-caption text-ink-500', className)} {...props} />
)

export const FieldError = ({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p role="alert" className={cn('text-caption text-danger-700', className)} {...props} />
)
