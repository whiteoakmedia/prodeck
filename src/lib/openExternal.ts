import { IS_WEB } from "./tauri";

/** Open a web page in the person's browser (the app window never navigates). */
export async function openExternal(url: string) {
  if (IS_WEB) {
    window.open(url, "_blank", "noopener");
    return;
  }
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}
