// Words for the secure local address's state (localhttps.rs Status.phase).

export function localPhaseLabel(phase: string): { text: string; tone: "online" | "" | "bad" } {
  switch (phase) {
    case "serving":
      return { text: "on", tone: "online" };
    case "claimed":
    case "addressing":
    case "certifying":
      return { text: "setting up", tone: "" };
    case "error":
      return { text: "needs attention", tone: "bad" };
    default:
      return { text: "off", tone: "" };
  }
}
