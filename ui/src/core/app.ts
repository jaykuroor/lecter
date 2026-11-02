import { type AppInfo, commands } from "./bindings";

export type { AppInfo };

/** The app's name and version from the core (`app_info`). */
export function appInfo(): Promise<AppInfo> {
  return commands.appInfo();
}
