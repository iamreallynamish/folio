import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./tailwind.css";
import "./styles.css";
import { App } from "./App.tsx";

const theme = localStorage.getItem("folio-theme");
if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
