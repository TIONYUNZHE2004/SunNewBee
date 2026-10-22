import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { Providers } from "./app/providers";
import "./index.css";
import { installDemoHook } from "./features/demo/demoHook";
import { applyDemoPreset } from "./features/demo/preset";
import { installJourneyHook } from "./features/journey/journeyHook";
import { applySunPin } from "./features/scene/three/sunClock";
import { applyTheme, startThemeClock, useTheme } from "./ui/theme";

const el = document.getElementById("root");
if (!el) throw new Error("#root missing");
applyDemoPreset();
// Acceptance runs (`?sun=pinned`) light the scene at the pinned sun time; normal loads use the clock.
applySunPin();
installJourneyHook({ dev: import.meta.env.DEV, search: window.location.search });
// window.__tl.demo (spec §7): dev server only. The e2e suite runs `pnpm dev`, so DEV covers it;
// no VITE_* variable reaches the client (envPrefix TL_PUBLIC_), hence no e2e flag here.
installDemoHook({ dev: import.meta.env.DEV });
applyTheme(useTheme.getState().theme);
startThemeClock();
createRoot(el).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>,
);
