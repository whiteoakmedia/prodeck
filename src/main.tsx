import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initCrashReports } from "./lib/crashReports";
import { IS_DEMO, IS_SHOTS } from "./lib/demo";

initCrashReports({ demo: IS_DEMO, shots: IS_SHOTS });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
