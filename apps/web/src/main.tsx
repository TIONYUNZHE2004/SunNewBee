import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { Providers } from "./app/providers";
import "./index.css";
import { applyDemoPreset } from "./features/demo/preset";
import { applyTheme, startThemeClock, useTheme } from "./ui/theme";

const el = document.getElementById("root");
if (!el) throw new Error("#root missing");
applyDemoPreset();
applyTheme(useTheme.getState().theme);
startThemeClock();
createRoot(el).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>,
);
