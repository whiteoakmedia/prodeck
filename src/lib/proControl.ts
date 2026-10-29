// May this screen change ProPresenter? Two things say no: the person lacks the
// control permission (phones), or the whole ProDeck is view only (Settings,
// ProPresenter). The core refuses either way (web.rs, propresenter.rs guard);
// this is so tiles show a monitor instead of buttons that would be refused.

import { useProDeck } from "../store";
import { usePerms } from "./perms";

export function useProControl(): { canControl: boolean; viewOnly: boolean } {
  const { settings } = useProDeck();
  const { can } = usePerms();
  const viewOnly = !!settings?.pp_view_only;
  return { canControl: can("control") && !viewOnly, viewOnly };
}
