// Next Slide leaderboard nicknames: the rules the phone checks as you type and
// the crew server enforces (crew-cloud/src/board.ts). Pure, shared by both.
// Nicknames are seen by crew at every church using ProDeck.

// Words a nickname may not contain anywhere. Short on purpose: White Oak
// Media's remove switch (/_admin/board/remove) handles the rest.
const ANYWHERE = [
  "fuck", "shit", "bitch", "cunt", "pussy", "asshole", "nigg", "retard", "porn", "penis", "vagina", "whore",
  "hitler", "nazi",
];
// Only as a whole word: inside real names they're fine (Hancock, Essex, Grape).
const WHOLE = ["dick", "cock", "sex", "rape", "fag", "slut", "bastard", "ass", "tits"];

/** Lowercase, lookalike digits as letters ("sh1t"). */
const plain = (s: string) =>
  s.toLowerCase().replace(/0/g, "o").replace(/[1!|]/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s");

/** Why a nickname can't be used, or "" if it can. */
export function nickProblem(raw: string): string {
  const nick = raw.trim().replace(/\s+/g, " ");
  if (nick.length < 2) return "At least 2 letters.";
  if (nick.length > 16) return "At most 16 characters.";
  if (!/^[\p{L}\p{N} .'_]+$/u.test(nick)) return "Letters, numbers and spaces only.";
  // Spaced out letters count as one word too ("f u c k").
  const flat = plain(nick).replace(/[^a-z]/g, "");
  const words = plain(nick).split(/[^a-z]+/).filter(Boolean);
  if (ANYWHERE.some((w) => flat.includes(w)) || words.some((w) => WHOLE.includes(w)) || WHOLE.includes(flat)) {
    return "Pick another name.";
  }
  return "";
}

export const cleanNick = (raw: string) => raw.trim().replace(/\s+/g, " ");

