import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { Providers } from "./app/providers";
import "./index.css";
import { applyTheme, useTheme } from "./ui/theme";

const el = document.getElementById("root");
if (!el) throw new Error("#root missing");
applyTheme(useTheme.getState().theme);
createRoot(el).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>,
);
