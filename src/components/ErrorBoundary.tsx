import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Last line of defence. An uncaught render error used to leave a black
 * screen — which is exactly what a booth operator sees at 9:40 on a Sunday
 * with no idea what to do. Now it says what broke, offers the two things
 * that actually help (reload, or reload with sample data off), and puts the
 * details on the clipboard for a problem report.
 */
interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
  info: ErrorInfo | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info });
    // Also to the console, so `Show recent log` and browser devtools have it.
    console.error("[prodeck] render crash:", error, info.componentStack);
  }

  private details(): string {
    const { error, info } = this.state;
    return [
      `ProDeck render crash`,
      `when: ${new Date().toISOString()}`,
      `error: ${error?.message ?? "(none)"}`,
      ``,
      error?.stack ?? "",
      ``,
      `component stack:${info?.componentStack ?? " (none)"}`,
    ].join("\n");
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    let demo = false;
    try {
      demo = localStorage.getItem("prodeck.demo") === "1";
    } catch {
      /* storage unavailable */
    }

    return (
      <div className="crash">
        <div className="crash-card">
          <h1>ProDeck hit an error.</h1>
          <p className="crash-lead">
            The screen stopped drawing, but nothing was lost — your settings and
            layouts are on disk. Reloading usually fixes it.
          </p>
          <pre className="crash-msg">{error.message}</pre>
          <div className="crash-actions">
            <button className="btn primary" onClick={() => location.reload()}>
              Reload ProDeck
            </button>
            {demo && (
              <button
                className="btn"
                onClick={() => {
                  try {
                    localStorage.removeItem("prodeck.demo");
                  } catch {
                    /* ignore */
                  }
                  location.reload();
                }}
              >
                Turn off demo mode &amp; reload
              </button>
            )}
            <button
              className="btn ghost"
              onClick={() => {
                navigator.clipboard
                  .writeText(this.details())
                  .then(() => this.setState({ copied: true }))
                  .catch(() => {});
              }}
            >
              {this.state.copied ? "Copied ✓" : "Copy error details"}
            </button>
          </div>
          <p className="crash-foot">
            If it keeps happening, paste the copied details into a report at{" "}
            <code>github.com/whiteoakmedia/prodeck/issues</code> — they contain no
            passwords.
          </p>
          <details className="crash-more">
            <summary>Technical details</summary>
            <pre>{this.details()}</pre>
          </details>
        </div>
      </div>
    );
  }
}
