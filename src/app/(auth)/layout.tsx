export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col px-5 py-16">
      <div className="rounded-[--radius-card] border border-ink-200 bg-white p-7 shadow-[--shadow-card]">
        {children}
      </div>
    </div>
  )
}
