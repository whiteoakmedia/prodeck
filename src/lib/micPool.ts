// Who gets a card on the Mic Assignments tile, before one-card-per-person.
//
// With mic positions chosen (Planning Center page, which positions wear a
// mic), it's those people plus anyone already given a mic. With none chosen,
// it's everyone serving. It used to fall back to "everyone" only while nobody
// had a mic yet, so assigning the first mic made everyone else vanish from the
// tile ("once 1 person is assigned, everyone else goes away").

export function micPool<T extends { id: string; position: string }>(
  active: T[],
  micPositions: string[],
  hasMic: (m: T) => boolean,
): T[] {
  if (micPositions.length === 0) return active;
  return active.filter((m) => micPositions.includes(m.position) || hasMic(m));
}
