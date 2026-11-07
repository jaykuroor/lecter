// The default keymap (10-keymap.md), as data. Bindings are written in key notation (notation.ts)
// and grouped by scope: which ones apply depends on the focused element (scopes.ts). A command
// is an id; the feature that does it registers a handler, and until one does, the key is left to
// the element (Vim, the browser). Ids starting with `+` name a leader group for which-key.

/** The modes the buffer reports; everything outside the buffer counts as normal. */
export type Mode = "normal" | "visual" | "insert";

/**
 * Where a binding applies: `global` everywhere (10-keymap.md#global-os-conventions); `app` where
 * Space is the leader; `buffer` on any element of the lecture buffer; `line` on a slide line and
 * an own-note line alike (10-keymap.md#on-a-slide-line); `gloss` on a gloss.
 */
export type Scope = "global" | "app" | "buffer" | "line" | "gloss";

export const SCOPES: readonly Scope[] = ["global", "app", "buffer", "line", "gloss"];

export interface Binding {
  keys: string;
  command: string;
  scope: Scope;
  /** What it does, for which-key, the hint bar and the Keys page. */
  desc: string;
  /** The modes it works in; by default every mode for `global`, normal and visual for `app`, normal elsewhere. */
  modes?: readonly Mode[];
  /** Passed to the handler (Ctrl-1…9: the course's index). */
  arg?: number;
}

/** A binding's modes, with the scope's default filled in. */
export function bindingModes(b: Binding): readonly Mode[] {
  if (b.modes) return b.modes;
  if (b.scope === "global") return ["normal", "visual", "insert"];
  if (b.scope === "app") return ["normal", "visual"];
  return ["normal"];
}

type Row = readonly [keys: string, command: string, desc: string];

function rows(scope: Scope, list: readonly Row[]): Binding[] {
  return list.map(([keys, command, desc]) => ({ keys, command, scope, desc }));
}

// 10-keymap.md#leader-groups.
const LEADER: readonly Row[] = [
  ["<leader>a", "+ai", "AI"],
  ["<leader>ag", "ai.gaps", "Gap finder"],
  ["<leader>am", "ai.pickModel", "Pick model"],
  ["<leader>af", "ai.figureMode", "Figure mode"],
  ["<leader>ac", "ai.courseChat", "Course chat"],
  ["<leader>s", "+search", "Search"],
  ["<leader>sg", "search.sources", "Sources"],
  ["<leader>ss", "search.slides", "Slides"],
  ["<leader>sn", "search.notes", "Notes across the course"],
  ["<leader>sw", "search.web", "Web"],
  ["<leader>x", "+lists", "Lists"],
  ["<leader>xx", "lists.doubts", "Doubts"],
  ["<leader>xf", "lists.flags", "Flags"],
  ["<leader>xl", "lists.later", "Later"],
  ["<leader>xo", "lists.officeHours", "Office hours"],
  ["<leader>xr", "lists.revise", "Revise"],
  ["<leader>f", "+files", "Files"],
  ["<leader>ff", "files.openSlides", "Open slides"],
  ["<leader>fr", "files.recent", "Recent lectures"],
  ["<leader>fn", "files.newLecture", "New lecture"],
  ["<leader>fs", "files.addSource", "Add source"],
  ["<leader>fR", "files.renameLecture", "Rename lecture"],
  ["<leader>u", "+ui", "UI"],
  ["<leader>uC", "ui.theme", "Theme"],
  ["<leader>ub", "ui.lightDark", "Light / dark"],
  ["<leader>ur", "ui.readMode", "Read mode"],
  ["<leader>uk", "ui.keystrokes", "Keystroke overlay"],
  ["<leader>uh", "ui.hintDetail", "Hint bar detail"],
  ["<leader>e", "sidebar.toggle", "Toggle sidebar"],
  ["<leader>r", "panel.toggle", "Toggle right panel"],
  ["<leader><leader>", "lecture.find", "Find lecture"],
  ["<leader>,", "buffer.switch", "Switch buffers"],
  ["<leader>?", "keys.help", "Keys for this element"],
  ["<leader>q", "+quit", "Quit"],
  ["<leader>qq", "app.quit", "Quit"],
];

// 10-keymap.md#move-everywhere, the keys Vim doesn't have (Vim's own are the VIM_KEPT list).
const MOVE: readonly Row[] = [
  ["<C-j>", "slide.next", "Next slide"],
  ["<C-k>", "slide.prev", "Previous slide"],
  ["]]", "slide.next", "Next slide"],
  ["[[", "slide.prev", "Previous slide"],
  ["]g", "gloss.next", "Next gloss"],
  ["[g", "gloss.prev", "Previous gloss"],
  ["]f", "flag.next", "Next flag"],
  ["[f", "flag.prev", "Previous flag"],
  ["]d", "doubt.next", "Next doubt"],
  ["[d", "doubt.prev", "Previous doubt"],
  ["]b", "step.next", "Next build step"],
  ["[b", "step.prev", "Previous build step"],
];

// 10-keymap.md#on-a-slide-line: the same on a slide line and an own-note line.
const LINE: readonly Row[] = [
  ["s", "ai.steps", "Steps"],
  ["q", "ai.doubt", "Park a doubt"],
  ["t", "ai.define", "Define terms"],
  ["'", "ai.example", "Worked example"],
  ["=", "ai.plot", "Plot"],
  ["<Tab>", "ai.write", "Write for me"],
  ["m", "flag.line", "Flag line"],
  ["M", "flag.slide", "Flag slide"],
  [".", "repeat", "Repeat the last action"],
  ["o", "note.below", "Own note below"],
  ["O", "note.above", "Own note above"],
  ["gd", "sources.goto", "Go to this idea in your sources"],
  ["gx", "parse.compare", "Compare parse with original"],
  ["i", "line.edit", "Edit / fix the line"],
];

// 10-keymap.md#on-a-gloss.
const GLOSS: readonly Row[] = [
  ["<CR>", "gloss.reply", "Reply in thread (keep a draft)"],
  ["r", "gloss.regenerate", "Regenerate"],
  ["-", "gloss.less", "Less detail"],
  ["=", "gloss.more", "More detail"],
  ["<lt>", "gloss.older", "Older variant"],
  [">", "gloss.newer", "Newer variant"],
  ["zg", "gloss.rateGood", "Rate good"],
  ["zw", "gloss.rateWrong", "Rate wrong"],
  ["i", "gloss.edit", "Edit the gloss"],
  ["gq", "gloss.tidy", "Tidy"],
  ["za", "fold.toggle", "Fold"],
  ["zM", "fold.all", "Fold all"],
  ["zR", "fold.none", "Unfold all"],
  ["dd", "gloss.delete", "Delete"],
  ["yy", "gloss.yank", "Yank as Markdown"],
  ["u", "undo", "Undo"],
  ["<C-r>", "redo", "Redo"],
  ["<Esc>", "gloss.stop", "Stop a streaming answer"],
];

// Ctrl-1…9 (Cmd on macOS): the nth course on the rail (10-keymap.md#global-os-conventions).
const COURSES: Binding[] = Array.from({ length: 9 }, (_, i) => ({
  keys: `<Mod-${i + 1}>`,
  command: "course.go",
  scope: "global" as const,
  desc: `Course ${i + 1}`,
  arg: i,
}));

// F6 / Shift-F6: the next / previous pane, in every mode and element (D-200, panes.ts).
const PANE_KEYS: Binding[] = [
  { keys: "<F6>", command: "focus.next", scope: "global", desc: "Next pane" },
  { keys: "<S-F6>", command: "focus.prev", scope: "global", desc: "Previous pane" },
];

// Ctrl/Cmd-Shift-P the command palette, Ctrl/Cmd-p the quick switcher (10-keymap.md#global-os-conventions;
// Ctrl/Cmd-K stays unbound off the buffer, where Ctrl-k is the previous slide). features/palette.
const PALETTE_KEYS: Binding[] = [
  { keys: "<Mod-S-p>", command: "palette.open", scope: "global", desc: "Command palette" },
  { keys: "<Mod-p>", command: "switcher.open", scope: "global", desc: "Quick switcher" },
];

// Ctrl/Cmd-, Settings (10-keymap.md#global-os-conventions). features/settings.
const SETTINGS_KEYS: Binding[] = [{ keys: "<Mod-,>", command: "settings.open", scope: "global", desc: "Settings" }];

/** The built-in bindings, before keymaps.jsonc (user.ts). */
export const DEFAULT_KEYMAP: readonly Binding[] = [
  ...COURSES,
  ...PANE_KEYS,
  ...PALETTE_KEYS,
  ...SETTINGS_KEYS,
  ...rows("app", LEADER),
  ...rows("buffer", MOVE),
  // A selection asks too (`v…Enter`).
  { keys: "<CR>", command: "ai.ask", scope: "line", desc: "Ask about this line", modes: ["normal", "visual"] },
  ...rows("line", LINE),
  ...rows("gloss", GLOSS),
];

/**
 * The Vim keys the buffer keeps (10-keymap.md#vim-subset-kept), in Vim's own notation. Vim
 * handles them; the engine only lists them (which-key, the Keys page) and keys/vim.ts drops every
 * other Vim key.
 */
export const VIM_KEPT: readonly string[] = [
  "h",
  "j",
  "k",
  "l",
  "w",
  "b",
  "e",
  "0",
  "^",
  "$",
  "gg",
  "G",
  "<C-d>",
  "<C-u>",
  "f",
  ";",
  ",",
  "/",
  "?",
  "n",
  "N",
  "*",
  "i",
  "a",
  "I",
  "A",
  "o",
  "O",
  "x",
  "d",
  "c",
  "y",
  "p",
  "P",
  "r",
  "u",
  "<C-r>",
  "v",
  "V",
  ".",
  "J",
  ">>",
  "<<",
  "<Esc>",
  "zz",
  "zt",
  "zb",
  "za",
  "zM",
  "zR",
];

/** Vim keys whose Vim meaning is given up (10-keymap.md#vim-subset-kept): the Lecter meaning wins. */
export const VIM_GIVEN_UP: readonly string[] = [
  "s",
  "S",
  "q",
  "t",
  "T",
  "m",
  "'",
  "`",
  "=",
  "<Tab>",
  "<CR>",
  "R",
  "H",
  "M",
  "L",
  "#",
];
