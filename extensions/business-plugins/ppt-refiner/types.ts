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
  configuration?: Readonly<{ id: string; revision?: number }>;
  /** Missing on legacy decks; it must not be guessed from the latest version number. */
  currentVersion?: number;
}>;
export type VersionEntry = Readonly<{
  version: number;
  at: string;
  pages: readonly number[];
  summary: string;
  diffs: readonly DiffEntry[];
  undone?: boolean;
  /** null is a known root; missing is legacy/unknown history. */
  parentVersion?: number | null;
  /** Only explicit false marks a content change without a verified difference record. */
  diffsKnown?: boolean;
}>;

export class DeckFault extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
