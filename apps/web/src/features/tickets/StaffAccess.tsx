/** Staff access: a password field wired to the shared staff token (session only). */
export function StaffAccess({ token, setToken }: { token: string; setToken: (v: string) => void }) {
  return (
    <div className="mb-4 rounded-lg border border-edge bg-raised p-3">
      <label htmlFor="staff-access" className="block text-sm font-semibold text-fg">
        Staff access
      </label>
      <input
        id="staff-access"
        type="password"
        autoComplete="off"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        className="mt-1 min-h-11 w-full rounded-lg border border-edge bg-surface px-3 text-sm text-fg"
      />
      <p className="mt-1 text-xs text-fg-soft">Kept for this browser session only.</p>
    </div>
  );
}
