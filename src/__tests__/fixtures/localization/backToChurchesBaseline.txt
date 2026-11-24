import { IN_CREW_APP, crewAppHome } from "../lib/crewApp";

/**
 * Inside the ProDeck Crew app, before signing in: a way back to the churches
 * list for someone who reached the wrong booth. Nothing in a browser.
 */
export function BackToChurches() {
  if (!IN_CREW_APP) return null;
  return (
    <button type="button" className="link-btn back-to-churches" onClick={() => (location.href = crewAppHome())}>
      Not your church? Back to your churches
    </button>
  );
}
