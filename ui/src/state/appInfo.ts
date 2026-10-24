import { createResource, type Resource } from "solid-js";
import { appInfo } from "../core/app";
import type { AppInfo } from "../core/commands";

/** The app's name and version, fetched once from the core. */
export function createAppInfo(): Resource<AppInfo> {
  const [info] = createResource(appInfo);
  return info;
}
