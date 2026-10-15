import { lazy, Suspense } from "react";
import { createBrowserRouter, Link, type RouteObject } from "react-router";
import { MainPage } from "../features/main/MainPage";
import { TicketsPage } from "../features/tickets/TicketsPage";
import { Shell } from "./Shell";

function NotFound() {
  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="text-xl font-semibold text-fg">Page not found</h1>
      <p className="mt-1 text-sm text-fg-soft">There is nothing at this address.</p>
      <Link
        to="/"
        className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent underline"
      >
        Back to the map
      </Link>
    </div>
  );
}

// DEV-only stylised-city preview (no keys, no billable tiles). The constant DEV check lets the
// production build drop the import entirely.
const StylisedPreview = import.meta.env.DEV
  ? lazy(() => import("../features/scene/cesium/stylised/StylisedPreview"))
  : null;
const devRoutes: RouteObject[] = StylisedPreview
  ? [
      {
        path: "/dev/stylised",
        element: (
          <Suspense fallback={null}>
            <StylisedPreview />
          </Suspense>
        ),
      },
    ]
  : [];

export const routes: RouteObject[] = [
  ...devRoutes,
  {
    element: <Shell />,
    children: [
      { path: "/", element: <MainPage /> },
      { path: "/tickets", element: <TicketsPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
