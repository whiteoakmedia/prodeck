import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackDialog, FeedbackHost } from "../components/FeedbackDialog";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { FEEDBACK_URL, loadContact, openFeedback, saveContact } from "../lib/feedback";

const io = vi.hoisted(() => ({ diag: vi.fn(), crash: vi.fn() }));
vi.mock("../lib/tauri", () => ({ IS_WEB: false, diagBundle: io.diag }));
vi.mock("../lib/crashReports", () => ({ reportRenderCrash: io.crash }));
const contact = { name: "  Home 東京  ", church: "  Service Props  ", email: "owner@example.org" };
const supplied = { title: "  Home page_ack 東京  ", details: "  Original report: service / Props 東京  " };
const diagnostic = '{"system":{"os":"TestOS","version":"27","arch":"arm64"},"prodeck":{"version":"9.8.7"},"log":"page_ack / Home 東京"}';
let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let close: ReturnType<typeof vi.fn>;
let clipboard: ReturnType<typeof vi.fn>;
let reload: ReturnType<typeof vi.fn>;
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const response = (value: unknown, ok = true) => ({ ok, json: async () => value });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  saveContact(contact);
  io.diag.mockReset().mockResolvedValue(diagnostic);
  io.crash.mockReset();
  fetchMock = vi.fn().mockResolvedValue(response({ ok: true, id: "ref-Home-東京" }));
  vi.stubGlobal("fetch", fetchMock);
  clipboard = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
  vi.stubGlobal("__APP_VERSION__", "test-version");
  reload = vi.fn();
  vi.stubGlobal("location", { reload });
  vi.spyOn(console, "error").mockImplementation(() => {});
  close = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});
async function mount(node: ReactNode) { await act(async () => root.render(node)); }
function button(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((b) => b.textContent === text);
  expect(found, `button ${text}`).toBeDefined();
  return found!;
}
async function click(text: string) { await act(async () => button(text).click()); }
async function input(id: string, value: string) {
  const element = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!;
  const proto = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function form(kind: "bug" | "feature" = "bug") {
  return <FeedbackDialog initial={{ kind, ...supplied }} page="caller-route / Home" console="desk-Props" onClose={close} />;
}
function payload() { return JSON.parse(fetchMock.mock.calls[0][1].body); }

describe("mounted feedback presentation and existing contracts", () => {
  it.each(["bug", "feature"] as const)("names the %s dialog, renders owned instructions and keeps supplied fields", async (kind) => {
    await mount(form(kind));
    expect(host.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe(kind === "bug" ? "Reportar un error" : "Proponer una función");
    expect([...host.querySelectorAll('[role="tab"]')].map((e) => e.textContent)).toEqual(["Reportar un error", "Proponer una función"]);
    expect(host.querySelector<HTMLInputElement>("#fb-title")?.value).toBe(supplied.title);
    expect(host.querySelector<HTMLTextAreaElement>("#fb-details")?.value).toBe(supplied.details);
    expect(host.querySelector<HTMLInputElement>("#fb-email")?.value).toBe(contact.email);
    expect(host.querySelector("legend")?.textContent).toBe("¿Qué tan importante es?");
    expect(host.textContent).toContain("Esto se envía de forma privada a White Oak Media, no a una página pública.");
    expect(host.querySelector<HTMLInputElement>("#fb-title")?.placeholder).toBe(kind === "bug" ? "La letra dejó de avanzar en la segunda canción" : "Mostrar la tonalidad de la siguiente canción en la pantalla del escenario");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("switches modes and keeps typed fields, callbacks and urgency enums", async () => {
    await mount(form());
    await input("fb-expected", "  Expect original Home 東京  ");
    await act(async () => host.querySelector<HTMLInputElement>("#fb-urgency-service")!.click());
    await click("Proponer una función");
    expect(host.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Proponer una función");
    expect(host.querySelector<HTMLInputElement>("#fb-title")?.value).toBe(supplied.title);
    await click("Enviar idea");
    expect(payload()).toEqual({ kind: "feature", ...supplied, expected: "  Expect original Home 東京  ", urgency: "nice", ...contact, app: { version: "9.8.7", os: "TestOS 27", arch: "arm64", console: "desk-Props", web: false, page: "caller-route / Home" }, diagnostics: diagnostic, screenshot: null });
    expect(fetchMock.mock.calls[0][0]).toBe(FEEDBACK_URL);
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json" });
    expect(loadContact()).toEqual(contact);
    expect(host.querySelector("h3")?.textContent).toBe("Gracias por la idea.");
    expect(host.textContent).toContain(`Si tiene alguna pregunta, te escribirá a ${contact.email}.`);
    expect(host.textContent).toContain("Referencia ref-Home-東京");
    expect([...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].every((b) => b.disabled)).toBe(true);
    await click("Listo");
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("shows pending copy, prevents cancellation while sending and preserves the bug request", async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    fetchMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    await mount(form());
    await act(async () => host.querySelector<HTMLInputElement>("#fb-urgency-service")!.click());
    await click("Enviar reporte");
    expect(button("Enviando…").disabled).toBe(true);
    expect(button("Cancelar").disabled).toBe(true);
    expect(button("Cerrar").disabled).toBe(true);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(close).not.toHaveBeenCalled();
    expect(payload()).toEqual({ kind: "bug", ...supplied, expected: "", urgency: "service", ...contact, app: { version: "9.8.7", os: "TestOS 27", arch: "arm64", console: "desk-Props", web: false, page: "caller-route / Home" }, diagnostics: diagnostic, screenshot: null });
    await act(async () => resolve(response({ ok: true, id: "ref-Home-東京" })));
    expect(host.querySelector("h3")?.textContent).toBe("Gracias, tu reporte está en camino.");
  });
  it("keeps raw backend failures and entered data, with no automatic resend", async () => {
    const raw = "  backend Home page_ack 東京 / E_AUTH  ";
    fetchMock.mockResolvedValue(response({ ok: false, error: raw }, false));
    await mount(form());
    await click("Enviar reporte");
    expect(host.querySelector(".error")?.textContent).toBe(raw);
    expect(host.querySelector<HTMLInputElement>("#fb-title")?.value).toBe(supplied.title);
    expect(host.querySelector<HTMLTextAreaElement>("#fb-details")?.value).toBe(supplied.details);
    expect(button("Enviar reporte").disabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await click("Cancelar");
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("keeps validation messages raw and rejected drafts leave saved contact and IO unchanged", async () => {
    await mount(form());
    await input("fb-details", "short");
    await input("fb-name", "unsaved name");
    await click("Enviar reporte");
    expect(host.querySelector(".error")?.textContent).toBe("Add a few more words about it.");
    expect(loadContact()).toEqual(contact);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(io.diag).not.toHaveBeenCalled();
    await click("Cerrar");
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("previews diagnostics verbatim, hides them and localizes only the unavailable fallback", async () => {
    await mount(form());
    await click("Ver exactamente qué se envía");
    expect(host.querySelector("pre")?.textContent).toBe(diagnostic);
    expect(io.diag.mock.calls).toEqual([[{ web: false, page: "caller-route / Home", from: "feedback" }]]);
    await click("Ocultar");
    expect(host.querySelector("pre")).toBeNull();
    io.diag.mockResolvedValue("");
    await click("Ver exactamente qué se envía");
    expect(host.querySelector("pre")?.textContent).toBe("El diagnóstico no está disponible en esta pantalla.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("handles empty reference and absent email without altering callback behavior", async () => {
    saveContact({ ...contact, email: "" });
    fetchMock.mockResolvedValue(response({ ok: true, id: "" }));
    await mount(form("feature"));
    await click("Enviar idea");
    expect(host.textContent).toContain("No dejaste un correo, así que no podrá responderte, pero tu mensaje cuenta.");
    expect(host.textContent).not.toContain("Referencia");
    await click("Listo");
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("opens and dismisses through the public feedback event with unchanged initial content", async () => {
    await mount(<FeedbackHost page="event-route" console="original-desk" />);
    await act(async () => openFeedback({ kind: "bug", ...supplied }));
    expect(host.querySelector<HTMLInputElement>("#fb-title")?.value).toBe(supplied.title);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const crash = new Error("  Original Home / page_ack 東京  ");
crash.stack = "Error: Original Home\n    at originalCommand (original.ts:12:3)";
function Broken(): ReactNode { throw crash; }
async function mountCrash(demo = false) {
  if (demo) localStorage.setItem("prodeck.demo", "1");
  await mount(<ErrorBoundary><Broken /></ErrorBoundary>);
}
describe("mounted ErrorBoundary recovery and diagnostic preservation", () => {
  it("passes healthy children through without crash reporting", async () => {
    await mount(<ErrorBoundary><p>  Caller Home 東京  </p></ErrorBoundary>);
    expect(host.textContent).toBe("  Caller Home 東京  ");
    expect(io.crash).not.toHaveBeenCalled();
  });
  it("renders localized help with exact raw error, captures once and copies unchanged technical details", async () => {
    await mountCrash();
    expect(host.querySelector("h1")?.textContent).toBe("ProDeck encontró un error.");
    expect(host.querySelector(".crash-msg")?.textContent).toBe(crash.message);
    expect(host.querySelector("summary")?.textContent).toBe("Detalles técnicos");
    expect(host.textContent).toContain("Tu configuración y");
    expect(host.textContent).toContain("Se incluyen los detalles del error, que no contienen contraseñas.");
    expect(io.crash).toHaveBeenCalledTimes(1);
    expect(io.crash.mock.calls[0][0]).toBe(crash);
    expect(io.crash.mock.calls[0][1]).toContain("Broken");
    await click("Copiar detalles del error");
    expect(button("Copiado ✓")).toBeDefined();
    const copied = clipboard.mock.calls[0][0];
    expect(copied).toMatch(/^ProDeck render crash\nwhen: .*\nerror: /);
    expect(copied).toContain(`error: ${crash.message}\n\n${crash.stack}\n\ncomponent stack:`);
    expect(copied).toContain(io.crash.mock.calls[0][1]);
    expect(host.querySelector(".crash-more pre")?.textContent).toContain(crash.stack);
    await click("Recargar ProDeck");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("prodeck.demo")).toBeNull();
  });
  it("turns off only demo mode and reloads, keeping saved contact", async () => {
    await mountCrash(true);
    await click("Desactivar el modo demo y recargar");
    expect(localStorage.getItem("prodeck.demo")).toBeNull();
    expect(loadContact()).toEqual(contact);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("opens the report with original technical strings and closes without network IO", async () => {
    await mountCrash();
    await click("Contarle a White Oak qué pasó");
    expect(host.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Reportar un error");
    expect(host.querySelector<HTMLInputElement>("#fb-title")?.value).toBe(`ProDeck stopped drawing: ${crash.message}`.slice(0, 140));
    const details = host.querySelector<HTMLTextAreaElement>("#fb-details")!.value;
    expect(details).toMatch(/^What I was doing when it happened:\n\n\n---\nProDeck render crash\nwhen: /);
    expect(details).toContain(crash.stack);
    await click("Ver exactamente qué se envía");
    expect(io.diag).toHaveBeenCalledWith({ web: false, page: "crash screen", from: "feedback" });
    await click("Cancelar");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(io.crash).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
