import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./tailwind.css";
import "./styles.css";
import { App } from "./App.tsx";
import { applyAccent } from "./ui/accent.ts";
import { registerWorker } from "./ui/push.ts";

const theme = localStorage.getItem("folio-theme");
if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
// The accent saved on this device until the account's own arrives (avoids a colour flash on launch).
applyAccent(document.documentElement.dataset.accent);
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
// Receives push notifications while Folio is closed.
registerWorker();
