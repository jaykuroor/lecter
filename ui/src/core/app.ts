import { invoke } from "@tauri-apps/api/core";
import type { AppInfo } from "./commands";

/** The app's name and version from the core (`app_info`). */
export function appInfo(): Promise<AppInfo> {
  return invoke<AppInfo>("app_info");
}
