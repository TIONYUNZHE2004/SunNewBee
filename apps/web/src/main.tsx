import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { Providers } from "./app/providers";
import "./index.css";
import { installJourneyHook } from "./features/journey/journeyHook";
import { applyTheme, startThemeClock, useTheme } from "./ui/theme";

const el = document.getElementById("root");
if (!el) throw new Error("#root missing");
installJourneyHook({ dev: import.meta.env.DEV, search: window.location.search });
applyTheme(useTheme.getState().theme);
startThemeClock();
createRoot(el).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>,
);
