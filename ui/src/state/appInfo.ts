import { createResource, type Resource } from "solid-js";
import { type AppInfo, appInfo } from "../core/app";

/** The app's name and version, fetched once from the core. */
export function createAppInfo(): Resource<AppInfo> {
  const [info] = createResource(appInfo);
  return info;
}
