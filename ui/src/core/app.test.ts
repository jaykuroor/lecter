import { beforeEach, describe, expect, it } from "vitest";
import { defaultFixture } from "../../e2e/mock-core/fixture";
import { installMockCore } from "../../e2e/mock-core/install";
import { appInfo } from "./app";

describe("appInfo", () => {
  beforeEach(() =>
    installMockCore({
      ...defaultFixture,
      appInfo: { name: "Lecter", version: "1.2.3" },
    }),
  );

  it("asks the core for app_info and returns its answer", async () => {
    await expect(appInfo()).resolves.toEqual({
      name: "Lecter",
      version: "1.2.3",
    });
  });

  it("rejects an unknown command with an IpcError from the mocked core", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    await expect(invoke("no_such_command")).rejects.toMatchObject({
      code: "E_INVALID_ARGUMENT",
      retryable: false,
    });
  });
});
