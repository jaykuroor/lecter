import type { TrustScreen } from "../../core/course";

/** `n` and the word, plural unless `n` is 1: "1 lecture", "12 slide decks". */
export function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** What the folder holds, as the trust screen's first line: "6 lectures · 12 slide decks · 3 sources". */
export function inside(screen: TrustScreen): string {
  return [
    count(screen.lectures, "lecture", "lectures"),
    count(screen.slides, "slide deck", "slide decks"),
    count(screen.sources, "source", "sources"),
  ].join(" · ");
}

/** The course's own AI files, each list with its heading, in the order the screen shows them. */
export function aiFiles(screen: TrustScreen): { label: string; items: string[] }[] {
  return [
    { label: "Course instructions", items: screen.agents },
    { label: "Roles", items: screen.roles },
    { label: "Skills", items: screen.skills },
    { label: "Settings overrides", items: screen.overrides },
  ];
}
