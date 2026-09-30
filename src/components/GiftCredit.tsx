import lightInk from "../assets/wom/wom-logo-light-ink.png";
import darkInk from "../assets/wom/wom-logo-dark-ink.png";
import { IS_WEB } from "../lib/tauri";

// Bottom of the sidebar: who gives ProDeck away. The logo opens
// whiteoakmedia.io in the browser (the app's own window never navigates).

const SITE = "https://whiteoakmedia.io/?utm_source=prodeck&utm_medium=app&utm_campaign=sidebar";

async function openSite() {
  if (IS_WEB) {
    window.open(SITE, "_blank", "noopener");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(SITE).catch(() => window.open(SITE, "_blank", "noopener"));
}

export function GiftCredit() {
  return (
    <a
      className="gift"
      href={SITE}
      onClick={(e) => {
        e.preventDefault();
        openSite();
      }}
      title="whiteoakmedia.io"
    >
      <span className="gift-line">A gift to every church from</span>
      <img className="gift-logo gift-logo-light" src={lightInk} alt="White Oak Media" />
      <img className="gift-logo gift-logo-dark" src={darkInk} alt="" aria-hidden="true" />
    </a>
  );
}
