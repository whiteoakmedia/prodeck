import { openExternal } from "../lib/openExternal";

// NDI's licence asks every app that uses NDI to carry this line and a link to
// ndi.video near where NDI is used or chosen.
export function NdiNotice() {
  return (
    <p className="muted small ndi-notice">
      NDI® is a registered trademark of Vizrt NDI AB.{" "}
      <a
        href="https://ndi.video"
        onClick={(e) => {
          e.preventDefault();
          openExternal("https://ndi.video");
        }}
      >
        ndi.video
      </a>
    </p>
  );
}
