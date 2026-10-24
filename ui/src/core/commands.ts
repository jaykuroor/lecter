// The IPC commands the UI calls, with their argument and result types (18-contracts.md#ipc).
// F-017 replaces this file's role with the generated `bindings.ts`; until then it is the one
// place the contract is written down, and the mocked core (e2e/mock-core) implements it.

/** `app_info`: what the shell shows about the running app. */
export interface AppInfo {
  name: string;
  version: string;
}

/** `IpcError` as every command returns it on failure (18-contracts.md#error-codes). */
export interface IpcError {
  code: string;
  message: string;
  retryable: boolean;
  detail?: string;
}

/** Command name → its arguments and result. */
export interface Commands {
  app_info: { args: Record<string, never>; result: AppInfo };
}

export type CommandName = keyof Commands;
