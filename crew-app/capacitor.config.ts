import type { CapacitorConfig } from "@capacitor/cli";

// ProDeck Crew (design/CREW_APP.md). The app opens each church's booth in
// its own web view, so navigation to any booth address is allowed: booths
// live on church networks (any private address or .local name), a church's
// own domain, or <name>.local.prodeck.live.
const config: CapacitorConfig = {
  appId: "app.prodeck.crew",
  appName: "ProDeck Crew",
  webDir: "dist",
  server: {
    allowNavigation: ["*"],
    // Booths on the church network are plain http.
    cleartext: true,
    androidScheme: "https",
  },
  backgroundColor: "#0e131b",
  android: {
    // The shell checks a booth over plain http on the church network.
    allowMixedContent: true,
  },
};

export default config;
