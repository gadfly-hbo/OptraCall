/** Frozen at the ordinary parent request's existing admission gate. */
export type ReportCalculationContract = { contract: 'foreground-report-calculation-v1' };

export function reportCalculationContract(input: {
  ordinaryPrompt: boolean;
  legacyEnabled: boolean;
  legacyAdmitted: boolean;
}): ReportCalculationContract | undefined {
  if (!input.ordinaryPrompt || input.legacyEnabled || input.legacyAdmitted) return undefined;
  return { contract: 'foreground-report-calculation-v1' };
}
