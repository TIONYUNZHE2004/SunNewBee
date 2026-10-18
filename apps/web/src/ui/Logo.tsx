/** TownshipLens mark: a shield (Sime Darby Property red, the only place the brand red appears)
 * holding a lens. Our own drawing, not the SDP logo. */
export function LogoMark({ className = "size-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <path
        d="M16 2.5 27 6.6v8.9c0 6.9-4.6 12.2-11 14-6.4-1.8-11-7.1-11-14V6.6z"
        fill="var(--c-brand-red)"
      />
      <circle cx="16" cy="15" r="5.2" fill="none" stroke="#fff" strokeWidth="2.2" />
      <path d="m19.8 18.8 3 3" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
