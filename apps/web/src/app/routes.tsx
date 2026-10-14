import { createBrowserRouter, NavLink, Outlet } from "react-router";
import { ManagePage } from "../features/manage/ManagePage";
import { useSite } from "../lib/api";
import { ResidentPage } from "./ResidentPage";

const navCls = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-sm font-medium ${isActive ? "bg-brand text-white" : "text-brand hover:bg-brand-tint"}`;

function Shell() {
  const site = useSite();
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div>
            <p className="text-lg font-semibold text-brand">TownshipLens</p>
            {site.data && <p className="text-sm text-ink-soft">{site.data.name}</p>}
          </div>
          <nav aria-label="Main" className="flex gap-1">
            <NavLink to="/" end className={navCls}>
              Resident
            </NavLink>
            <NavLink to="/manage" className={navCls}>
              Manage
            </NavLink>
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-line bg-card px-4 py-3 text-xs text-ink-soft">
        <p className="mx-auto max-w-7xl">
          © OpenStreetMap contributors (ODbL). Copernicus DEM GLO-30 © DLR/Airbus, provided under
          COPERNICUS by the EU and ESA. HAND: ASF (CC0).
        </p>
      </footer>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: "/", element: <ResidentPage /> },
      { path: "/manage", element: <ManagePage /> },
    ],
  },
]);
