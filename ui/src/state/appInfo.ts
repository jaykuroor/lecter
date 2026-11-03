import { type Accessor, createResource, type Resource } from "solid-js";
import { type AppInfo, appInfo } from "../core/app";

/**
 * The app's name and version, fetched once from the core as soon as `ready` is true: the shell
 * asks after its first paint, so the call doesn't hold it up (14-quality.md#performance-budgets).
 */
export function createAppInfo(ready: Accessor<boolean>): Resource<AppInfo> {
  const [info] = createResource(ready, () => appInfo());
  return info;
}
