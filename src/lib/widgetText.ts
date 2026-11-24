import type { WidgetGroup } from "../widgets/registry";
import { glossary } from "./uiText";

// Display only. Group IDs and ordering remain owned by the registry.
export const WIDGET_GROUP_LABELS: Record<WidgetGroup, string> = {
  "Mission Control": glossary.commandCenter,
  ProPresenter: "ProPresenter",
  "Planning Center": "Planning Center",
  Audio: "Audio",
  Video: "Video",
  General: "General",
};
