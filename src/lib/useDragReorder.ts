import { useRef, useState, type DragEvent } from "react";
import { dropIndex } from "./reorder";

// Drag-to-reorder for a vertical (or horizontal) list of rows, HTML5 drag and
// drop. `group` keeps drags inside one list (a step can't be dropped into
// another checklist). Touch screens don't do HTML5 drag — the ↑/↓ buttons
// next to each handle cover them.
export function useDragReorder(onMove: (group: string, from: number, to: number) => void, axis: "y" | "x" = "y") {
  const drag = useRef<{ group: string; index: number } | null>(null);
  const [over, setOver] = useState<{ group: string; index: number; after: boolean } | null>(null);

  const rowProps = (group: string, index: number) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      drag.current = { group, index };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", `${group}:${index}`); // Firefox needs data to start a drag
      e.stopPropagation();
    },
    onDragOver: (e: DragEvent) => {
      const d = drag.current;
      if (!d || d.group !== group) return;
      e.preventDefault();
      e.stopPropagation();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const after = axis === "y" ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
      if (!over || over.group !== group || over.index !== index || over.after !== after) setOver({ group, index, after });
    },
    onDrop: (e: DragEvent) => {
      const d = drag.current;
      if (!d || d.group !== group) return;
      e.preventDefault();
      e.stopPropagation();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const after = axis === "y" ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
      const to = dropIndex(d.index, index, after);
      if (to !== d.index) onMove(group, d.index, to);
      drag.current = null;
      setOver(null);
    },
    onDragEnd: () => {
      drag.current = null;
      setOver(null);
    },
  });
  /** "drop-before" / "drop-after" while a drag hovers this row. */
  const dropClass = (group: string, index: number) =>
    over && over.group === group && over.index === index ? (over.after ? "drop-after" : "drop-before") : "";
  return { rowProps, dropClass };
}
