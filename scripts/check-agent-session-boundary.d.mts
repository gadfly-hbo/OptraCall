export type SessionBoundaryViolation = { file: string; line: number; reason: string };
export type SessionBoundarySource = { file: string; source: string };
export function inspectSessionSource(file: string, source: string): SessionBoundaryViolation[];
export function inspectSessionSources(sources: SessionBoundarySource[]): SessionBoundaryViolation[][];
export function checkAgentSessionBoundary(root: string): Promise<SessionBoundaryViolation[]>;
