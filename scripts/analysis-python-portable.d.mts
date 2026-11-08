/** Explicit engineering archive extraction; not an Agent or HTTP interface. */
export declare function extractPortablePython(input: {
  archive: string;
  root: string;
  sha256: string;
  bytes: number;
}): Promise<{ files: number }>;
