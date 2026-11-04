import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles.css";
import { App } from "./App";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { initCrash, tagCrash } from "./crash";

initCrash();
if (Capacitor.isNativePlatform()) {
  import("@capacitor/app")
    .then(({ App: Cap }) => Cap.getInfo())
    .then((i) => tagCrash({ platform: Capacitor.getPlatform(), build: i.build }))
    .catch(() => {});
}

// Dark status bar on the phone, matching the app (and the booth's crew app
// once it opens: the setting is the phone's, so it stays).
if (Capacitor.isNativePlatform()) {
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  if (Capacitor.getPlatform() === "android") StatusBar.setBackgroundColor({ color: "#0e131b" }).catch(() => {});
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
