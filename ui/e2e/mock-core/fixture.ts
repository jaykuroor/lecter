import type { AppInfo } from "../../src/core/commands";

/** The data the mocked core serves. Tests override parts of it per flow. */
export interface MockFixture {
  appInfo: AppInfo;
}

export const defaultFixture: MockFixture = {
  appInfo: { name: "Lecter", version: "0.0.1" },
};
