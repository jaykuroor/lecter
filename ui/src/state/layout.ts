import { type Accessor, createSignal } from "solid-js";
import { getLayout, saveLayout } from "../core/layout";

/** Which parts of the window show, remembered across restarts (D-195). */
export interface LayoutState {
  /** Whether the sidebar shows (`␣e`); `true` until `load` says otherwise. */
  sidebar: Accessor<boolean>;
  /**
   * Shows or hides the sidebar at once and saves that in the core without waiting (the key path
   * never awaits the core). A save that fails leaves the toggle as it is for this run.
   */
  toggleSidebar: () => void;
  /**
   * Reads the layout the last run saved. A toggle made before the answer arrives wins over it,
   * and a core that can't answer leaves the sidebar showing.
   */
  load: () => Promise<void>;
}

export function createLayout(): LayoutState {
  const [sidebar, setSidebar] = createSignal(true);
  let toggled = false;

  function toggleSidebar(): void {
    toggled = true;
    const next = !sidebar();
    setSidebar(next);
    void saveLayout({ sidebar: next }).catch(() => {});
  }

  async function load(): Promise<void> {
    try {
      const result = await getLayout();
      if (result.status === "ok" && !toggled) setSidebar(result.data.sidebar);
    } catch {
      // Without the core the sidebar shows, as on a first start.
    }
  }

  return { sidebar, toggleSidebar, load };
}
