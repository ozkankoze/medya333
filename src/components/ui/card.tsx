import * as React from 'react'
import { cn } from '@/lib/utils'

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-[--radius-card] border border-ink-200 bg-white shadow-[--shadow-card]',
        'transition-shadow duration-[--duration-base] ease-[--ease-out-soft]',
        className,
      )}
      {...props}
    />
  ),
)
Card.displayName = 'Card'

export const CardHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-1.5 p-6 pb-4', className)} {...props} />
)

export const CardTitle = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn('text-h3 text-ink-900', className)} {...props} />
)

export const CardDescription = ({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn('text-small text-ink-500', className)} {...props} />
)

export const CardContent = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('p-6 pt-0', className)} {...props} />
)

export const CardFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex items-center gap-3 p-6 pt-0', className)} {...props} />
)

/** Seçilebilir kart — platform/hizmet/varyant seçiminde kullanılır. */
export interface SelectableCardProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean
}

export const SelectableCard = React.forwardRef<HTMLButtonElement, SelectableCardProps>(
  ({ className, selected = false, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected}
      className={cn(
        'group relative flex w-full flex-col items-start gap-1 rounded-[--radius-card] border bg-white p-4 text-left',
        'transition-[transform,border-color,box-shadow] duration-[--duration-fast] ease-[--ease-out-soft]',
        'hover:-translate-y-0.5 hover:shadow-[--shadow-lifted]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
        selected
          ? 'border-brand-500 ring-1 ring-brand-500 shadow-[--shadow-lifted]'
          : 'border-ink-200 shadow-[--shadow-card]',
        className,
      )}
      {...props}
    />
  ),
)
SelectableCard.displayName = 'SelectableCard'
