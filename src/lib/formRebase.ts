// The Settings page edits a copy of the settings and saves it whole. Other
// places save settings too (the setup wizards, the Recording page), and a copy
// taken earlier would put their old values back on the next Save. When the
// settings change underneath the form, a field the person hasn't touched
// takes the new value; one they're editing keeps their edit.

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

export function rebase<T extends object>(form: T, base: T, next: T): T {
  const out = { ...next } as Record<string, unknown>;
  const f = form as Record<string, unknown>;
  const b = base as Record<string, unknown>;
  for (const k of Object.keys(f)) {
    if (!same(f[k], b[k])) out[k] = f[k]; // edited here: keep the edit
  }
  return out as T;
}
