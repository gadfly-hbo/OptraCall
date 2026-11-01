export type DiffKind = 'wording' | 'number' | 'layout' | 'regenerate';
export type DiffEntry = Readonly<{
  page: number;
  kind: DiffKind;
  summary: string;
  anchor: 'covered' | 'uncovered-confirmed' | 'none';
}>;
export type DeckMeta = Readonly<{
  id: string;
  title: string;
  sourceReport: string;
  lockedPages: readonly number[];
  createdAt: string;
  updatedAt: string;
}>;
export type VersionEntry = Readonly<{
  version: number;
  at: string;
  pages: readonly number[];
  summary: string;
  diffs: readonly DiffEntry[];
}>;

export class DeckFault extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
