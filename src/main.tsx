/** Entry point: mounts the App and loads the base stylesheet. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
// Side-effect import: applies the stored theme's CSS variables on load so the
// first paint is correct (no flash of the fallback theme).
import "./themes/useTheme";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);