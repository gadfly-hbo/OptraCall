import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { EVIDENCE_CONFIDENCE, PRIORITIES, EVIDENCE_LEVELS, type BoardItemRecord, type BoardTaskRecord, type Evidence, type EvidenceLevel, type ExtractionConfiguration, type ExtractionRecord, type ExtractionStatus, type FeedbackEffect, type NormalizedItem, type Priority, type ReportRecord, type SaveFeedbackInput, type TaskFeedbackRevision, type TaskStatus } from '../types.ts';

export class DecisionBoardFault extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = 'DecisionBoardFault'; this.code = code; }
}
function fail(code: string): never { throw new DecisionBoardFault(code); }

const DATABASE = 'decision-board.sqlite3';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const openRoots = new Map<string, number>();
const now = () => new Date().toISOString();

const SCHEMA = `
CREATE TABLE reports (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 project_id TEXT NOT NULL, relative_path TEXT NOT NULL,
 observed_sha256 TEXT, observed_bytes INTEGER, observed_at TEXT,
 last_extraction_at TEXT,
 first_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(project_id, relative_path)
);
CREATE TABLE extractions (
 id TEXT PRIMARY KEY,
 report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE RESTRICT,
 configuration_json TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('running','completed','failed','cancelled','interrupted')),
 error TEXT,
 source_sha256 TEXT NOT NULL, source_bytes INTEGER NOT NULL,
 source_chars INTEGER NOT NULL, truncated INTEGER NOT NULL,
 item_count INTEGER, dropped_item_count INTEGER,
 session_file TEXT, report_excerpt TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE board_items (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL,
 report_id INTEGER REFERENCES reports(id) ON DELETE RESTRICT,
 extraction_id TEXT,
 source_kind TEXT NOT NULL CHECK(source_kind IN ('extracted','manual')),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 rationale TEXT NOT NULL CHECK(length(rationale) BETWEEN 1 AND 4000),
 expected_impact TEXT NOT NULL DEFAULT '' CHECK(length(expected_impact)<=2000),
 priority TEXT NOT NULL CHECK(priority IN ('high','medium','low')),
 effort TEXT CHECK(effort IS NULL OR length(effort)<=200),
 confidence REAL CHECK(confidence IS NULL OR (confidence>0 AND confidence<=1)),
 evidence_level TEXT CHECK(evidence_level IS NULL OR evidence_level IN ('数据支撑','多源佐证','逻辑推断','经验假设')),
 evidence_json TEXT,
 status TEXT NOT NULL CHECK(status IN ('suggested','adopted','dismissed')),
 dismissed_reason TEXT, decided_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK((status='dismissed' AND dismissed_reason IS NOT NULL AND length(dismissed_reason)>=2) OR (status!='dismissed' AND dismissed_reason IS NULL))
);
CREATE TABLE board_tasks (
 id TEXT PRIMARY KEY,
 item_id TEXT NOT NULL REFERENCES board_items(id) ON DELETE RESTRICT,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 owner TEXT CHECK(owner IS NULL OR length(owner)<=200),
 due_date TEXT CHECK(due_date IS NULL OR length(due_date)<=40),
 note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=2000),
 status TEXT NOT NULL CHECK(status IN ('todo','doing','done')),
 priority TEXT NOT NULL CHECK(priority IN ('high','medium','low')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE task_feedback (
 task_id TEXT PRIMARY KEY REFERENCES board_tasks(id) ON DELETE RESTRICT,
 adopted INTEGER NOT NULL CHECK(adopted IN (0,1)),
 outcome TEXT NOT NULL DEFAULT '' CHECK(length(outcome)<=4000),
 metric_delta TEXT NOT NULL DEFAULT '' CHECK(length(metric_delta)<=1000),
 review TEXT NOT NULL DEFAULT '' CHECK(length(review)<=4000),
 score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX board_items_report ON board_items(report_id);
CREATE INDEX board_tasks_item ON board_tasks(item_id);
PRAGMA user_version=1;
`;

const FEEDBACK_SCHEMA = `
CREATE TABLE feedback_revisions (
 revision_id TEXT PRIMARY KEY,
 task_id TEXT NOT NULL REFERENCES board_tasks(id) ON DELETE RESTRICT,
 revision_number INTEGER NOT NULL CHECK(revision_number>0),
 operation_id TEXT UNIQUE, request_sha256 TEXT,
 adopted INTEGER NOT NULL CHECK(adopted IN (0,1)),
 outcome TEXT NOT NULL CHECK(length(outcome)<=4000),
 metric_delta TEXT NOT NULL CHECK(length(metric_delta)<=1000),
 review TEXT NOT NULL CHECK(length(review)<=4000),
 score INTEGER CHECK(score IS NULL OR (score BETWEEN 1 AND 5 AND score=CAST(score AS INTEGER))),
 effect TEXT NOT NULL CHECK(effect IN ('unknown','positive','negative','none')),
 saved_at TEXT NOT NULL,
 origin TEXT NOT NULL CHECK(origin IN ('user-save','legacy-current')),
 legacy_created_at TEXT, legacy_updated_at TEXT,
 UNIQUE(task_id,revision_number),
 CHECK((origin='user-save' AND operation_id IS NOT NULL AND request_sha256 IS NOT NULL AND length(request_sha256)=64 AND legacy_created_at IS NULL AND legacy_updated_at IS NULL)
    OR (origin='legacy-current' AND operation_id IS NULL AND request_sha256 IS NULL AND revision_number=1 AND legacy_created_at IS NOT NULL AND legacy_updated_at IS NOT NULL))
);
`;

function camel(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase()), value]));
}
function strip(raw: Record<string, unknown>, keys: string[]): Record<string, unknown> { const result = { ...raw }; for (const key of keys) delete result[key]; return result; }
const report = (row: Record<string, unknown>): ReportRecord => camel(row) as unknown as ReportRecord;
const item = (row: Record<string, unknown>): BoardItemRecord => ({ ...strip(camel(row), ['evidenceJson']) as unknown as BoardItemRecord, evidence: row.evidence_json === null ? null : JSON.parse(String(row.evidence_json)) as Evidence });
const task = (row: Record<string, unknown>): BoardTaskRecord => camel(row) as unknown as BoardTaskRecord;
const extraction = (row: Record<string, unknown>): ExtractionRecord => {
  const value = strip(camel(row), ['configurationJson']) as unknown as ExtractionRecord;
  return { ...value, configuration: JSON.parse(String(row.configuration_json)) as ExtractionConfiguration, truncated: Number(row.truncated) === 1 };
};
const feedback = (row: Record<string, unknown>): TaskFeedbackRevision => {
  const record = camel(row) as unknown as TaskFeedbackRevision;
  return { ...record, adopted: Number(row.adopted) === 1, createdAt: record.legacyCreatedAt ?? record.savedAt, updatedAt: record.legacyUpdatedAt ?? record.savedAt };
};

function text(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.includes('\0')) fail('invalid_text');
  const trimmed = value.trim();
  if ([...trimmed].length > max || (required && !trimmed.length)) fail('invalid_text');
  return trimmed;
}
function optional(value: unknown, max: number): string | null { return value == null || String(value).trim() === '' ? null : text(value, max); }
function priority(value: unknown, fallback: Priority = 'medium'): Priority { return value === undefined || value === null || value === '' ? fallback : PRIORITIES.includes(value as Priority) ? value as Priority : fail('invalid_text'); }
function uuid(value: string) { if (!UUID.test(value)) fail('invalid_text'); return value; }
function relativeReportPath(value: unknown): string {
  const result = text(value, 4096), pieces = result.split('/');
  if (pieces.length < 2 || pieces[0] !== '060_reports' || pieces.some(piece => !piece || piece === '.' || piece === '..') || /[\\\x00-\x1f\x7f]/.test(result)) fail('invalid_report_path');
  return result;
}
function transaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec('BEGIN');
  try { const result = operation(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

function schemaInventory(db: DatabaseSync) {
  return db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all().map(row => ({ ...row, sql: row.sql === null ? null : String(row.sql).replace(/;$/, '').replace(/\s+/g, ' ').trim() }));
}
function validateSchema(db: DatabaseSync, version: number): void {
  const expected = new DatabaseSync(':memory:', { allowExtension: false });
  try {
    if (version > 0) expected.exec(SCHEMA);
    if (version === 2) expected.exec(FEEDBACK_SCHEMA);
    if (JSON.stringify(schemaInventory(db)) !== JSON.stringify(schemaInventory(expected))) fail('unsupported_board_schema');
  } finally { expected.close(); }
  if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) fail('invalid_board_database');
}

function feedbackInput(taskId: string, input: SaveFeedbackInput) {
  if (!input.operationId || !Object.hasOwn(input, 'expectedLatestRevisionId')) fail('feedback_client_upgrade_required');
  const operationId = uuid(input.operationId);
  const expectedLatestRevisionId = input.expectedLatestRevisionId === null ? null : uuid(input.expectedLatestRevisionId);
  const score = input.score === undefined ? null : input.score;
  const effect = input.effect ?? 'unknown';
  if (typeof input.adopted !== 'boolean' || (score !== null && (!Number.isSafeInteger(score) || score < 1 || score > 5)) || !['unknown', 'positive', 'negative', 'none'].includes(effect)) fail('invalid_feedback');
  const bounded = (value: unknown, max: number) => {
    if (value === undefined) return '';
    if (typeof value !== 'string' || value.includes('\0') || value.length > max) fail('invalid_feedback');
    return value.trim();
  };
  // This fixed object order is the canonical payload; absent optional fields
  // normalize to the same explicit values as the corresponding UI controls.
  return { taskId, operationId, expectedLatestRevisionId, adopted: input.adopted, outcome: bounded(input.outcome, 4000), metricDelta: bounded(input.metricDelta, 1000), review: bounded(input.review, 4000), score, effect: effect as FeedbackEffect };
}

/** Local decision-board storage. Only this directory is owned; report files stay
 * read-only in their projects and are identified by observation hashes. */
export function createDecisionBoardStore(options: { root: string }) {
  const root = path.resolve(options.root);
  let db: DatabaseSync | null = null;
  const database = (): DatabaseSync => { if (!db) fail('board_store_unavailable'); return db; };

  function init(): Promise<void> {
    close();
    if (openRoots.get(root)) fail('board_store_busy');
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const directory = fs.lstatSync(root);
    if (!directory.isDirectory() || directory.isSymbolicLink()) fail('unsafe_board_storage');
    const file = path.join(root, DATABASE);
    if (!fs.existsSync(file)) { const handle = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600); fs.closeSync(handle); }
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail('unsafe_board_storage');
    let upgrading = false;
    try {
      db = new DatabaseSync(file, { allowExtension: false });
      openRoots.set(root, (openRoots.get(root) ?? 0) + 1);
      const after = fs.lstatSync(file);
      if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1 || stat.ino !== after.ino || stat.dev !== after.dev) fail('unsafe_board_storage');
      db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000;');
      const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
      if (![0, 1, 2].includes(version)) fail('unsupported_board_schema');
      validateSchema(db, version);
      db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
      if (db.prepare('PRAGMA journal_mode').get()?.journal_mode !== 'delete' || db.prepare('PRAGMA synchronous').get()?.synchronous !== 2 || db.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 1) fail('unsafe_board_storage');
      if (version < 2) {
        upgrading = true;
        transaction(db, () => {
          if (version === 0) database().exec(SCHEMA);
          database().exec(FEEDBACK_SCHEMA);
          const at = now();
          for (const legacy of database().prepare('SELECT * FROM task_feedback ORDER BY task_id').all()) {
            database().prepare(`INSERT INTO feedback_revisions (revision_id,task_id,revision_number,operation_id,request_sha256,adopted,outcome,metric_delta,review,score,effect,saved_at,origin,legacy_created_at,legacy_updated_at) VALUES (?,?,1,NULL,NULL,?,?,?,?,?,'unknown',?,'legacy-current',?,?)`)
              .run(randomUUID(), legacy.task_id!, legacy.adopted!, legacy.outcome!, legacy.metric_delta!, legacy.review!, legacy.score!, at, legacy.created_at!, legacy.updated_at!);
          }
          database().exec('PRAGMA user_version=2;');
        });
        upgrading = false;
      }
      // A running row can only come from a previous process; it never resumes silently.
      db.prepare("UPDATE extractions SET status='interrupted', updated_at=? WHERE status='running'").run(now());
      return Promise.resolve();
    } catch (error) { close(); if (upgrading && !(error instanceof DecisionBoardFault)) fail('board_migration_failed'); throw error; }
  }
  function close(): void {
    if (!db) return;
    try { db.close(); } finally {
      db = null;
      const remaining = (openRoots.get(root) ?? 1) - 1;
      if (remaining > 0) openRoots.set(root, remaining); else openRoots.delete(root);
    }
  }

  function registerReport(input: { projectId: string; relativePath: string; sha256: string; bytes: number }): ReportRecord {
    const projectId = uuid(input.projectId), relativePath = relativeReportPath(input.relativePath);
    if (!/^[a-f0-9]{64}$/.test(input.sha256) || !Number.isSafeInteger(input.bytes) || input.bytes < 0) fail('invalid_observation');
    const at = now();
    return transaction(database(), () => {
      const existing = database().prepare('SELECT * FROM reports WHERE project_id=? AND relative_path=?').get(projectId, relativePath) as Record<string, unknown> | undefined;
      if (!existing) {
        database().prepare('INSERT INTO reports (project_id,relative_path,observed_sha256,observed_bytes,observed_at,first_seen_at,updated_at) VALUES (?,?,?,?,?,?,?)')
          .run(projectId, relativePath, input.sha256, input.bytes, at, at, at);
      } else if (existing.observed_sha256 !== input.sha256 || existing.observed_bytes !== input.bytes) {
        database().prepare('UPDATE reports SET observed_sha256=?, observed_bytes=?, observed_at=?, updated_at=? WHERE id=?')
          .run(input.sha256, input.bytes, at, at, Number(existing.id));
      }
      return report(database().prepare('SELECT * FROM reports WHERE project_id=? AND relative_path=?').get(projectId, relativePath) as Record<string, unknown>);
    });
  }
  function getReport(id: number): ReportRecord | null {
    const row = database().prepare('SELECT * FROM reports WHERE id=?').get(id) as Record<string, unknown> | undefined;
    return row ? report(row) : null;
  }
  const listReports = (): ReportRecord[] => (database().prepare('SELECT * FROM reports ORDER BY project_id, relative_path').all() as Record<string, unknown>[]).map(report);

  function createExtraction(input: { id: string; reportId: number; configuration: ExtractionConfiguration; sourceSha256: string; sourceBytes: number; sourceChars: number; truncated: boolean; reportExcerpt: string }): ExtractionRecord {
    const id = uuid(input.id);
    if (!getReport(input.reportId)) fail('report_not_found');
    if (!/^[a-f0-9]{64}$/.test(input.sourceSha256) || !Number.isSafeInteger(input.sourceBytes) || input.sourceBytes < 0 || !Number.isSafeInteger(input.sourceChars) || input.sourceChars < 0) fail('invalid_observation');
    const configurationJson = JSON.stringify({ id: text(input.configuration?.id, 200, true), name: text(input.configuration?.name, 200), provider: text(input.configuration?.provider, 200), model: text(input.configuration?.model, 200), revision: Number(input.configuration?.revision) });
    const excerpt = typeof input.reportExcerpt === 'string' && input.reportExcerpt.length ? input.reportExcerpt : fail('invalid_text');
    const at = now();
    return transaction(database(), () => {
      const running = database().prepare("SELECT id FROM extractions WHERE report_id=? AND status='running'").get(input.reportId) as { id: string } | undefined;
      if (running && running.id !== id) fail('extraction_busy');
      database().prepare('INSERT INTO extractions (id,report_id,configuration_json,status,source_sha256,source_bytes,source_chars,truncated,report_excerpt,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, input.reportId, configurationJson, 'running', input.sourceSha256, input.sourceBytes, input.sourceChars, input.truncated ? 1 : 0, excerpt, at, at);
      return readExtraction(id)!;
    });
  }
  function readExtraction(id: string): ExtractionRecord | null {
    const row = database().prepare('SELECT * FROM extractions WHERE id=?').get(id) as Record<string, unknown> | undefined;
    return row ? extraction(row) : null;
  }
  const listExtractions = (): ExtractionRecord[] => (database().prepare('SELECT * FROM extractions ORDER BY created_at DESC').all() as Record<string, unknown>[]).map(extraction);
  const runningExtractionForReport = (reportId: number): ExtractionRecord | null => {
    const row = database().prepare("SELECT * FROM extractions WHERE report_id=? AND status='running'").get(reportId) as Record<string, unknown> | undefined;
    return row ? extraction(row) : null;
  };

  function finishExtraction(id: string, outcome:
    | { kind: 'completed'; items: NormalizedItem[]; dropped?: number; sessionFile?: string }
    | { kind: 'failed' | 'cancelled'; error?: string; sessionFile?: string }): ExtractionRecord {
    uuid(id);
    return transaction(database(), () => {
      const current = readExtraction(id);
      if (!current) fail('extraction_not_found');
      if (current.status !== 'running') fail('extraction_conflict');
      const at = now();
      if (outcome.kind !== 'completed') {
        database().prepare('UPDATE extractions SET status=?, error=?, session_file=COALESCE(?,session_file), updated_at=? WHERE id=?')
          .run(outcome.kind, outcome.error ?? null, outcome.sessionFile ?? null, at, id);
        return readExtraction(id)!;
      }
      const owner = getReport(current.reportId);
      if (!owner) fail('report_not_found');
      // Only still-suggested extracted items are rebuilt; decided items and manual
      // entries are decision assets and always survive a new round.
      database().prepare("DELETE FROM board_items WHERE report_id=? AND source_kind='extracted' AND status='suggested'").run(current.reportId);
      for (const entry of outcome.items) {
        const level = EVIDENCE_LEVELS.includes(entry.evidence.level) ? entry.evidence.level : fail('invalid_text');
        database().prepare('INSERT INTO board_items (id,project_id,report_id,extraction_id,source_kind,title,rationale,expected_impact,priority,effort,confidence,evidence_level,evidence_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(randomUUID(), owner.projectId, current.reportId, id, 'extracted',
            text(entry.title, 200, true), text(entry.rationale, 4000, true), text(entry.expectedImpact ?? '', 2000), priority(entry.priority),
            optional(entry.effort, 200), EVIDENCE_CONFIDENCE[level as EvidenceLevel], level, JSON.stringify(entry.evidence), 'suggested', at, at);
      }
      database().prepare('UPDATE extractions SET status=?, item_count=?, dropped_item_count=?, session_file=COALESCE(?,session_file), updated_at=? WHERE id=?')
        .run('completed', outcome.items.length, outcome.dropped ?? 0, outcome.sessionFile ?? null, at, id);
      database().prepare('UPDATE reports SET last_extraction_at=?, updated_at=? WHERE id=?').run(at, at, current.reportId);
      return readExtraction(id)!;
    });
  }

  const listItems = (): BoardItemRecord[] => (database().prepare('SELECT * FROM board_items ORDER BY created_at, id').all() as Record<string, unknown>[]).map(item);
  function getItem(id: string): BoardItemRecord {
    const row = database().prepare('SELECT * FROM board_items WHERE id=?').get(id) as Record<string, unknown> | undefined;
    return row ? item(row) : fail('item_not_found');
  }
  function addManualItem(input: { projectId: string; title: string; rationale: string; expectedImpact?: string; priority?: string }): BoardItemRecord {
    const at = now(), id = randomUUID();
    database().prepare('INSERT INTO board_items (id,project_id,report_id,extraction_id,source_kind,title,rationale,expected_impact,priority,confidence,evidence_level,evidence_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, uuid(input.projectId), null, null, 'manual', text(input.title, 200, true), text(input.rationale, 4000, true), text(input.expectedImpact ?? '', 2000), priority(input.priority),
        EVIDENCE_CONFIDENCE['经验假设'], '经验假设', null, 'suggested', at, at);
    return getItem(id);
  }
  function decideItem(id: string, decision: { status: 'adopted' } | { status: 'dismissed'; reason: string }): BoardItemRecord {
    uuid(id);
    const current = getItem(id), at = now();
    if (decision.status === 'adopted') {
      if (current.status === 'dismissed') fail('item_already_dismissed');
      if (current.status === 'adopted') fail('invalid_item_decision');
      database().prepare("UPDATE board_items SET status='adopted', decided_at=?, updated_at=? WHERE id=?").run(at, at, id);
    } else {
      const reason = decision.reason?.trim() ?? '';
      if ([...reason].length < 2) fail('invalid_dismiss_reason');
      if (current.status === 'dismissed') fail('invalid_item_decision');
      database().prepare("UPDATE board_items SET status='dismissed', dismissed_reason=?, decided_at=?, updated_at=? WHERE id=?").run(reason, at, at, id);
    }
    return getItem(id);
  }

  function addTask(itemId: string, input: { title: string; owner?: string; dueDate?: string; priority?: string; note?: string }): BoardTaskRecord {
    const owner = getItem(itemId);
    if (owner.status !== 'adopted') fail('task_requires_adoption');
    const id = randomUUID(), at = now();
    database().prepare('INSERT INTO board_tasks (id,item_id,title,owner,due_date,note,status,priority,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, itemId, text(input.title, 200, true), optional(input.owner, 200), optional(input.dueDate, 40), text(input.note ?? '', 2000), 'todo', priority(input.priority), at, at);
    const row = database().prepare('SELECT * FROM board_tasks WHERE id=?').get(id) as Record<string, unknown>;
    return task(row);
  }
  const listTasks = (): BoardTaskRecord[] => (database().prepare('SELECT * FROM board_tasks ORDER BY created_at, id').all() as Record<string, unknown>[]).map(task);
  function getTask(taskId: string): BoardTaskRecord {
    const row = database().prepare('SELECT * FROM board_tasks WHERE id=?').get(uuid(taskId));
    return row ? task(row) : fail('task_not_found');
  }
  function setTaskStatus(taskId: string, status: string): BoardTaskRecord {
    uuid(taskId);
    if (!['todo', 'doing', 'done'].includes(String(status))) fail('invalid_text');
    const result = database().prepare('UPDATE board_tasks SET status=?, updated_at=? WHERE id=?').run(String(status), now(), taskId);
    if (result.changes === 0) fail('task_not_found');
    return task(database().prepare('SELECT * FROM board_tasks WHERE id=?').get(taskId) as Record<string, unknown>);
  }
  function saveFeedback(taskId: string, input: SaveFeedbackInput): TaskFeedbackRevision {
    uuid(taskId);
    const clean = feedbackInput(taskId, input);
    const digest = createHash('sha256').update(JSON.stringify(clean)).digest('hex');
    return transaction(database(), () => {
      getTask(taskId);
      const prior = getFeedbackOperation(clean.operationId);
      if (prior) {
        if (prior.requestSha256 !== digest) fail('feedback_operation_conflict');
        return prior;
      }
      const latest = database().prepare('SELECT revision_id,revision_number FROM feedback_revisions WHERE task_id=? ORDER BY revision_number DESC LIMIT 1').get(taskId);
      if ((latest?.revision_id ?? null) !== clean.expectedLatestRevisionId) fail('feedback_revision_conflict');
      const revisionId = randomUUID();
      database().prepare(`INSERT INTO feedback_revisions (revision_id,task_id,revision_number,operation_id,request_sha256,adopted,outcome,metric_delta,review,score,effect,saved_at,origin,legacy_created_at,legacy_updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'user-save',NULL,NULL)`)
        .run(revisionId, taskId, Number(latest?.revision_number ?? 0) + 1, clean.operationId, digest, clean.adopted ? 1 : 0, clean.outcome, clean.metricDelta, clean.review, clean.score, clean.effect, now());
      return getFeedbackRevision(revisionId)!;
    });
  }
  function listFeedbackHistory(taskId: string): TaskFeedbackRevision[] {
    getTask(taskId);
    return database().prepare('SELECT * FROM feedback_revisions WHERE task_id=? ORDER BY revision_number').all(taskId).map(feedback);
  }
  function getFeedbackRevision(revisionId: string): TaskFeedbackRevision | null {
    const row = database().prepare('SELECT * FROM feedback_revisions WHERE revision_id=?').get(uuid(revisionId));
    return row ? feedback(row) : null;
  }
  function getFeedbackOperation(operationId: string): TaskFeedbackRevision | null {
    const row = database().prepare('SELECT * FROM feedback_revisions WHERE operation_id=?').get(uuid(operationId));
    return row ? feedback(row) : null;
  }
  const listFeedback = (): TaskFeedbackRevision[] => database().prepare('SELECT f.* FROM feedback_revisions f WHERE NOT EXISTS (SELECT 1 FROM feedback_revisions n WHERE n.task_id=f.task_id AND n.revision_number>f.revision_number) ORDER BY f.saved_at,f.task_id').all().map(feedback);

  return { init, close, registerReport, getReport, listReports, createExtraction, readExtraction, listExtractions, runningExtractionForReport, finishExtraction, listItems, getItem, addManualItem, decideItem, addTask, getTask, listTasks, setTaskStatus, saveFeedback, listFeedback, listFeedbackHistory, getFeedbackRevision, getFeedbackOperation };
}
