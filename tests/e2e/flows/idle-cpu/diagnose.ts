// TEMPORARY (F-180 diagnosis run, removed before the feature is done): idle phases that change one
// thing each, to find the idle redraw's source by the CPU it costs.

import { sample } from "./sample.ts";
import { series } from "./threads.ts";

interface Phase {
  name: string;
  /** Runs in the page; returns a note on what it did. */
  act: () => string;
}

const PHASES: Phase[] = [
  { name: "base: editor focused", act: () => "nothing" },
  {
    name: "caret-animation manual on .cm-content",
    act: () => {
      const ok = CSS.supports("caret-animation", "manual");
      const s = document.createElement("style");
      s.id = "diag-caret";
      s.textContent = ".cm-content { caret-animation: manual !important; }";
      document.head.append(s);
      return `supported ${ok}; computed ${getComputedStyle(document.querySelector(".cm-content") as Element).getPropertyValue("caret-animation")}`;
    },
  },
  {
    name: "editor focused, DOM selection removed",
    act: () => {
      document.getElementById("diag-caret")?.remove();
      getSelection()?.removeAllRanges();
      return `active ${document.activeElement?.className}`;
    },
  },
  {
    name: "blurred (nothing focused)",
    act: () => {
      (document.activeElement as HTMLElement | null)?.blur();
      return `active ${document.activeElement?.nodeName}`;
    },
  },
  {
    name: "plain contenteditable div focused (caret transparent)",
    act: () => {
      const d = document.createElement("div");
      d.id = "diag-ce";
      d.contentEditable = "true";
      d.textContent = "plain editable text";
      d.style.cssText = "position:fixed;left:10px;bottom:10px;caret-color:transparent;";
      document.body.append(d);
      d.focus();
      const r = document.createRange();
      r.setStart(d.firstChild as Node, 3);
      r.collapse(true);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(r);
      return `active ${document.activeElement?.id}; sel ${getSelection()?.type}`;
    },
  },
  {
    name: "same div contenteditable=false tabindex=0, focused, caret inside",
    act: () => {
      const d = document.getElementById("diag-ce") as HTMLElement;
      d.tabIndex = 0;
      d.contentEditable = "false";
      d.focus();
      const r = document.createRange();
      r.setStart(d.firstChild as Node, 3);
      r.collapse(true);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(r);
      return `active ${document.activeElement?.id}; sel ${getSelection()?.type}`;
    },
  },
  {
    name: "same div editable, caret-animation manual",
    act: () => {
      const d = document.getElementById("diag-ce") as HTMLElement;
      d.contentEditable = "true";
      d.style.setProperty("caret-animation", "manual");
      d.focus();
      const r = document.createRange();
      r.setStart(d.firstChild as Node, 3);
      r.collapse(true);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(r);
      return `active ${document.activeElement?.id}; computed ${getComputedStyle(d).getPropertyValue("caret-animation")}`;
    },
  },
  {
    name: "everything hidden, nothing focused",
    act: () => {
      (document.activeElement as HTMLElement | null)?.blur();
      getSelection()?.removeAllRanges();
      document.body.style.display = "none";
      return "body hidden";
    },
  },
];

/** Runs each phase for `ms` after a short settle and reports its CPU per process and top threads. */
export async function diagnose(exe: string, report: (line: string) => void, ms = 40_000): Promise<void> {
  for (const phase of PHASES) {
    const note = await browser.execute(phase.act);
    await browser.pause(3_000);
    const s = series(await sample(exe, ms, ms));
    const total = s.procs.reduce((a, p) => a + p.total, 0);
    const parts = s.procs.map(
      (p) =>
        `${p.name} ${p.total.toFixed(0)} (${p.threads
          .slice(0, 5)
          .filter((t) => t.total >= 1)
          .map((t) => `${t.name}${t.count > 1 ? `×${t.count}` : ""} ${t.total.toFixed(0)}`)
          .join(", ")})`,
    );
    report(
      `idle-diagnosis ${phase.name}: ${((total / 1000 / s.seconds) * 100).toFixed(2)} % (${total.toFixed(0)} ms / ${s.seconds.toFixed(0)} s) [${note}] ${parts.join("; ")}`,
    );
  }
}
