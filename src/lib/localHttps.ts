import { NAME_MAX, NAME_MIN, nameProblem } from "../../local-edge/src/names";

// Words for the secure local address's state (localhttps.rs Status.phase).

export function localPhaseLabel(phase: string): { text: string; tone: "online" | "" | "bad" } {
  switch (phase) {
    case "serving":
      return { text: "activo", tone: "online" };
    case "claimed":
    case "addressing":
    case "certifying":
      return { text: "configurando", tone: "" };
    case "error":
      return { text: "requiere atención", tone: "bad" };
    default:
      return { text: "desactivado", tone: "" };
  }
}

// The shared validator is also used by the worker; translate only its known
// presentation messages here so its protocol and validation stay unchanged.
export function localNameProblem(name: string): string {
  const problem = nameProblem(name);
  const messages: Record<string, string> = {
    [`At least ${NAME_MIN} letters or numbers.`]: `Usá al menos ${NAME_MIN} letras o números.`,
    [`At most ${NAME_MAX} characters.`]: `Usá como máximo ${NAME_MAX} caracteres.`,
    "Only lowercase letters, numbers and hyphens.": "Usá solo letras minúsculas, números y guiones.",
    "Can't start or end with a hyphen.": "El nombre no puede empezar ni terminar con un guion.",
    "No double hyphens.": "No uses dos guiones seguidos.",
    "That name is reserved. Try your church's name.": "Ese nombre está reservado. Probá con el nombre de tu iglesia.",
  };
  return messages[problem] ?? problem;
}
