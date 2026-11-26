import "./platform/legacy-keys.ts"; // must stay first: renames old browser keys before anything reads them
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App.tsx";
import { ErrorBoundary } from "./ui/ErrorBoundary.tsx";
import { initLanguage } from "./i18n.tsx";

initLanguage();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
