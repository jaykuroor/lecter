// Turns off @wdio/tauri-service's window-focus check for the current WebDriver session (D-154).
//
// Before every find, `$`, `$$`, click and getTitle, the service (1.5.0, `ensureActiveWindowFocus`)
// asks the app for its window states through `window.__wdio_original_core__`, which only its own
// tauri-plugin-wdio defines. This app embeds tauri-plugin-wdio-webdriver instead, so each check
// waits 5 s, logs "core.invoke not available after 5s timeout" and goes on. The service skips the
// check once the session has made an explicit window switch (its `afterCommand` adds the session to
// `userSwitchedWindowCache`), and the app has one window, so switching to the current window
// changes nothing else.
//
// wdio.conf.ts calls this in `before` for each flow's session; a flow that opens a session of its
// own (`reloadSession`) calls it again. support/timings.ts counts the stalls left in each flow.

/** The two WebDriver commands this needs (wdio.conf.ts can't name the wdio globals' types). */
export interface Session {
  getWindowHandle(): Promise<string>;
  switchToWindow(handle: string): Promise<unknown>;
}

export async function skipFocusCheck(session: Session): Promise<void> {
  try {
    await session.switchToWindow(await session.getWindowHandle());
  } catch (e) {
    // The flows still pass, only slower; the stall count in the job summary shows it.
    console.log(`window switch failed, the service's focus check stays on: ${String(e)}`);
  }
}
