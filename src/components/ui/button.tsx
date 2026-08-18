import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[--radius-control] text-small font-medium ' +
    'transition-[transform,background-color,border-color,opacity] duration-[--duration-fast] ease-[--ease-out-soft] ' +
    'active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50 ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
  {
    variants: {
      variant: {
        primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-[--shadow-card]',
        secondary: 'bg-white text-ink-900 border border-ink-200 hover:bg-ink-50',
        ghost: 'text-ink-700 hover:bg-ink-100',
        danger: 'bg-danger-600 text-white hover:bg-danger-700',
        link: 'text-brand-600 underline-offset-4 hover:underline px-0',
      },
      size: {
        sm: 'h-9 px-3.5',
        md: 'h-11 px-5',
        // Mobil dokunma hedefi minimum 44px — CTA'larda lg kullanılır
        lg: 'h-12 px-6 text-body',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, block, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size, block }), className)}
      {...props}
    />
  ),
)
Button.displayName = 'Button'

export { buttonVariants }
