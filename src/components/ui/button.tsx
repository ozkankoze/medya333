import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[--radius-control] text-small font-medium ' +
    'transition-[transform,background-color,border-color,opacity] duration-[--duration-fast] ease-[--ease-out-soft] ' +
    'active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50 ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
  {
    variants: {
      variant: {
        /**
         * ⚠️ BİRİNCİL DÜĞME METALİKTİR, DÜZ ALTIN DEĞİL.
         *
         * Tek renk altın dolgu ekranda "sarı düğme" gibi okunuyor ve tam
         * olarak kaçınmak istediğimiz ucuz his üretiyor. Üstten alta çok
         * kısa bir gradyan (gold-300 → gold-600) logodaki dökme metal
         * hissini taşır; üst kenardaki 1px beyaz iç ışık ise metalin
         * ışığı yakalayan tepesidir.
         *
         * ⚠️ METİN KOYU — beyaz DEĞİL. Altının üstünde beyaz metin
         * 2.5:1 civarında kalır ve WCAG AA'yı geçmez; ink-975 ile 6:1+.
         */
        /**
         * ⚠️ PASİF HÂLDE ALTIN KALMAZ. Yalnızca opaklık düşürmek soluk
         * krem bir levha bırakıyordu: ödeme düğmesi hem "tıklanabilir"
         * görünüyor hem de en pahalı elemanı ucuzlatıyordu. Pasif hâl
         * NÖTR GRİDİR — "henüz değil" mesajı tek bakışta okunur.
         */
        primary:
          'bg-gradient-to-b from-gold-300 to-gold-600 text-ink-975 font-semibold ' +
          'shadow-[--shadow-card] ring-1 ring-inset ring-white/25 ' +
          'hover:brightness-110 hover:shadow-[--shadow-hover] hover:-translate-y-px active:translate-y-0 ' +
          'disabled:bg-none disabled:bg-ink-150 disabled:text-ink-400 disabled:shadow-none ' +
          'disabled:ring-ink-200 disabled:opacity-100',
        secondary:
          'bg-white text-ink-900 border border-ink-200 hover:bg-ink-50 hover:border-brand-300',
        /** Koyu yüzeyler (hero bandı) için — altın CTA'nın yanındaki ikincil eylem. */
        onDark:
          'bg-white/10 text-white border border-white/20 backdrop-blur-sm ' +
          'hover:bg-white/15 hover:border-white/30',
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
      /**
       * ⚠️ Yükleniyor durumu görünürdür ve TIKLAMAYI KAPATIR.
       * Sadece opaklık düşürmek, kullanıcının ikinci kez tıklamasını
       * engellemez — çift sipariş riski buradan doğar.
       */
      loading: { true: 'pointer-events-none', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false, loading: false },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, block, loading, type = 'button', children, ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-busy={loading ? true : undefined}
      disabled={props.disabled || Boolean(loading)}
      className={cn(buttonVariants({ variant, size, block, loading }), className)}
      {...props}
    >
      {loading && (
        <svg className="size-4 shrink-0 animate-spin" viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" fill="none" opacity="0.25" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </svg>
      )}
      {children}
    </button>
  ),
)
Button.displayName = 'Button'

export { buttonVariants }
