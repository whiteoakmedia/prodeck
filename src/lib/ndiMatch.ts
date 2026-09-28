// Which NDI source is a ProPresenter screen? ProPresenter publishes a screen's
// NDI output as "HOST (Screen Name)" — the part in brackets is the name.
export function ndiForScreen(sources: { name: string }[], screen: string): string | null {
  const want = screen.trim().toLowerCase();
  if (!want) return null;
  const inner = (n: string) => (n.match(/\(([^)]*)\)\s*$/)?.[1] ?? n).trim().toLowerCase();
  return (
    sources.find((s) => inner(s.name) === want)?.name ??
    sources.find((s) => inner(s.name).includes(want) || want.includes(inner(s.name)))?.name ??
    null
  );
}
