/**
 * Which playlist item is live, when the live presentation was started from a
 * playlist (the usual way on a Sunday).
 *
 * It matters because a playlist item names the arrangement being played, and
 * ProPresenter's playlist-scoped thumbnail counts slides in that arrangement:
 * the same space as the live slide number. The presentation-scoped thumbnail
 * does not reliably; when ProPresenter doesn't report a current arrangement it
 * counts in stored order, so the Slide Preview showed "Slide 7" with a
 * different slide's picture on any song whose arrangement reorders or repeats
 * groups. Reported as "the slide count number was correct, but what was being
 * displayed was not the actual lyric on screen".
 */

export interface LiveItem {
  /** Playlist uuid, as the playlist endpoints accept it. */
  playlistId: string;
  /** The item's position in the playlist: the index the playlist endpoints expect. */
  itemIndex: number;
  /** The arrangement the item plays, or "" when it plays the stored order. */
  arrangementUuid: string;
}

const idOf = (x: any) => x?.id ?? x ?? null;

/** The playlist named by `playlist/active`, or null when nothing came from a playlist. */
export function activePlaylistId(active: any): string | null {
  const pl = idOf(active?.presentation?.playlist);
  const uuid = pl?.uuid;
  return typeof uuid === "string" && uuid ? uuid : null;
}

/**
 * Match `playlist/active` against the playlist's items. Null unless the item
 * it names plays the presentation that is actually live: an operator who
 * clicks a song in the library leaves the playlist pointing at its last item,
 * and borrowing that item's arrangement would be confidently wrong.
 */
export function resolveLiveItem(active: any, playlist: any, livePresUuid: string | null): LiveItem | null {
  const playlistId = activePlaylistId(active);
  if (!playlistId || !livePresUuid) return null;
  const item = idOf(active?.presentation?.item);
  const items: any[] = playlist?.items ?? playlist?.playlist?.items ?? [];
  if (!Array.isArray(items) || !items.length) return null;

  let at = item?.uuid ? items.findIndex((it) => it?.id?.uuid === item.uuid) : -1;
  if (at < 0 && typeof item?.index === "number") at = item.index;
  const hit = items[at];
  if (!hit || hit?.presentation_info?.presentation_uuid !== livePresUuid) return null;
  return {
    playlistId,
    itemIndex: at,
    arrangementUuid: (hit?.presentation_info?.arrangement_uuid ?? "").toString(),
  };
}
