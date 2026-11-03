// The idle_cpu_pct gate of the idle flow (F-180 criterion 2; 14-quality.md#performance-budgets:
// < 0.5 % average over a 5-minute idle sample). Linux and macOS gate at the spec's 0.5 %; Windows
// reports until the maintainer sets its per-OS target (D-161: only if WebView2's own baseline
// can't be cut). Gated at ×1, as the spec's value, with no CI allowance.

/** The spec's target, percent of one core. */
export const IDLE_CPU_PCT = 0.5;

/** The OSes the flow gates on (criterion 2); the others print REPORT. */
export const GATED = ["linux", "darwin"];

export function verdict(pct: number, os: string): { outcome: "pass" | "fail" | "report"; line: string } {
  const value = `idle_cpu_pct ${pct.toFixed(2)}`;
  if (!GATED.includes(os)) return { outcome: "report", line: `REPORT ${value} (no gate on ${os} yet, D-161)` };
  return pct < IDLE_CPU_PCT
    ? { outcome: "pass", line: `PASS ${value} < ${IDLE_CPU_PCT} on ${os}` }
    : { outcome: "fail", line: `FAIL ${value} ≥ ${IDLE_CPU_PCT} on ${os}` };
}
