import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askConfirm, askText, DialogHost } from "../lib/dialogs";
import { WizardShell } from "../components/wizard/WizardShell";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { fn(0); return 0; });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function mount(node: ReactNode) { await act(async () => root.render(node)); }
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent === label);
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
async function key(value: string) {
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true })));
}

describe("localized shared dialogs", () => {
  it("renders owned copy and preserves confirm true, false, queue and caller labels", async () => {
    await mount(<DialogHost />);
    let yes!: Promise<boolean>;
    let no!: Promise<boolean>;
    await act(async () => {
      yes = askConfirm("Home page_ack Evento original");
      no = askConfirm("Untouched title", "Delete original");
    });
    expect(host.querySelector(".dlg-title")?.textContent).toBe("Home page_ack Evento original");
    expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Cancelar", "Aceptar"]);
    await click("Aceptar");
    expect(await yes).toBe(true);
    expect(host.querySelector(".dlg-title")?.textContent).toBe("Untouched title");
    expect(host.textContent).toContain("Delete original");
    await click("Cancelar");
    expect(await no).toBe(false);
    expect(host.textContent).toBe("");
  });
  it("preserves text verbatim, including empty input, and cancels with null", async () => {
    await mount(<DialogHost />);
    let value!: Promise<string | null>;
    const original = "  Home / page_ack / 東京  ";
    await act(async () => { value = askText("Caller title", original); });
    expect(host.querySelector("input")?.value).toBe(original);
    await click("Aceptar");
    expect(await value).toBe(original);
    await act(async () => { value = askText("Caller title", "original"); });
    const input = host.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(await value).toBe("");
    await act(async () => { value = askText("Cancel", original); });
    await key("Escape");
    expect(await value).toBeNull();
  });
  it("preserves keyboard, backdrop and unmounted fallback behavior", async () => {
    expect(await askConfirm("No host")).toBe(false);
    expect(await askText("No host")).toBeNull();
    await mount(<DialogHost />);
    let result!: Promise<boolean>;
    await act(async () => { result = askConfirm("Keyboard"); });
    await key("Enter");
    expect(await result).toBe(true);
    await act(async () => { result = askConfirm("Backdrop"); });
    await act(async () => host.querySelector(".dlg")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(host.querySelector(".dlg")).not.toBeNull();
    await act(async () => host.querySelector(".dlg-backdrop")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(await result).toBe(false);
  });
});

describe("localized wizard frame", () => {
  it("renders actual step count, preserves supplied content, callbacks and step gating", async () => {
    const onGo = vi.fn();
    const onClose = vi.fn();
    const props = {
      title: "Setup Home", steps: [{ id: "a", label: "First" }, { id: "b", label: "Second" }, { id: "page_ack", label: "Third" }],
      at: 1, onGo, onClose, children: <input defaultValue="User value" />, actions: <button onClick={() => onGo(99)}>Next original</button>,
    };
    await mount(<WizardShell {...props} />);
    expect(host.querySelector(".wz-eyebrow")?.textContent).toBe("Paso 2 de 3");
    expect(host.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Setup Home");
    expect([...host.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["1First", "2Second", "3Third"]);
    expect(host.querySelector("input")?.value).toBe("User value");
    await click("Atrás");
    expect(onGo.mock.calls).toEqual([[0]]);
    await act(async () => host.querySelectorAll("li")[2].click());
    expect(onGo.mock.calls).toEqual([[0]]);
    await click("Next original");
    expect(onGo.mock.calls).toEqual([[0], [99]]);
    await click("Cerrar");
    await key("Escape");
    await act(async () => host.querySelector(".wz")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(2);
    await act(async () => host.querySelector(".wz-backdrop")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(3);
    await mount(<WizardShell {...props} at={0} />);
    expect(host.querySelector(".wz-eyebrow")?.textContent).toBe("Paso 1 de 3");
    expect([...host.querySelectorAll("button")].find((b) => b.textContent === "Atrás")?.disabled).toBe(true);
    await mount(<WizardShell {...props} busy steps={props.steps.map((s) => ({ ...s, done: true }))} />);
    expect([...host.querySelectorAll("button")].find((b) => b.textContent === "Atrás")?.disabled).toBe(true);
    await act(async () => host.querySelectorAll("li")[2].click());
    expect(onGo).toHaveBeenLastCalledWith(2);
  });
});
