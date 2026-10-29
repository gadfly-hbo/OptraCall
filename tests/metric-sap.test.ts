import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseSapDraft, preparePublication, canonicalSapYaml, sapFingerprints, SapFault } from '../extensions/business-plugins/metric-factory/sap/validate.ts';

const fixtureRoot = path.resolve(import.meta.dirname, '../extensions/business-plugins/metric-factory/fixtures');
const draftBytes = () => new Uint8Array(readFileSync(path.join(fixtureRoot, 'membership-repurchase@1.0.0.draft.yaml')));

function edited(transform: (text: string) => string): Uint8Array {
  return new Uint8Array(Buffer.from(transform(readFileSync(path.join(fixtureRoot, 'membership-repurchase@1.0.0.draft.yaml'), 'utf8')), 'utf8'));
}
const fault = (error: unknown): SapFault => { assert.ok(error instanceof SapFault, `expected SapFault, got ${String(error)}`); return error as SapFault; };

test('MF-01: synthetic draft parses and publication fills the package fingerprint', () => {
  const document = parseSapDraft(draftBytes());
  assert.equal(document.package.id, 'membership-repurchase');
  assert.equal(document.metrics.length, 4);
  assert.equal(document.scenarios.length, 2);
  const publication = preparePublication(draftBytes());
  assert.match(publication.packageFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.match(publication.contentFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.match(publication.canonicalYaml, /fingerprint: "sha256:[a-f0-9]{16,}"/);
  assert.equal(publication.canonicalYaml, canonicalSapYaml(publication.document));
});

test('MF-01: canonical serialization and fingerprints are stable across recomputation', () => {
  const first = preparePublication(draftBytes());
  const second = preparePublication(new Uint8Array(Buffer.from(first.canonicalYaml, 'utf8')));
  assert.equal(first.canonicalYaml, second.canonicalYaml);
  assert.equal(first.packageFingerprint, second.packageFingerprint);
  assert.equal(first.contentFingerprint, second.contentFingerprint);
  assert.equal(first.bytesSha256, second.bytesSha256);
});

test('MF-01: version bump with unchanged content keeps content fingerprint, changes package fingerprint', () => {
  const original = preparePublication(draftBytes());
  const bumped = preparePublication(edited(text => text.replace('version: 1.0.0', 'version: 1.1.0')));
  assert.notEqual(original.contentFingerprint, undefined);
  assert.equal(bumped.contentFingerprint, original.contentFingerprint);
  assert.notEqual(bumped.packageFingerprint, original.packageFingerprint);
});

test('MF-01: origin=llm metric without reviewed_by is rejected', () => {
  const bytes = edited(text => text.replace('      reviewed_by: huangbo\n', ''));
  assert.throws(() => parseSapDraft(bytes), error => { const f = fault(error); assert.equal(f.code, 'SAP_UNREVIEWED'); assert.match(f.path, /^metrics\./); return true; });
});

test('MF-01: origin=template without template_ref is rejected', () => {
  const bytes = edited(text => text.replace('    provenance:\n      origin: llm\n      model: mimo-v2.6-flash\n      reviewed_by: huangbo', '    provenance:\n      origin: template').replace('version: 1.1.0', 'version: 1.0.0'));
  assert.throws(() => parseSapDraft(bytes), error => { assert.equal(fault(error).code, 'SAP_STRUCTURE'); return true; });
});

test('MF-01: dangling scenario metric reference is rejected', () => {
  const bytes = edited(text => text.replace('metric: repurchase_gap_days', 'metric: repurchase_velocity'));
  assert.throws(() => parseSapDraft(bytes), error => { assert.equal(fault(error).code, 'SAP_DANGLING_REFERENCE'); return true; });
});

test('MF-01: metric dimension outside the declared set is rejected', () => {
  const bytes = edited(text => text.replace('    dimensions:\n      - channel\n      - member_tier\n    time_grains:\n      - month\n      - quarter\n    owner_role: 会员运营负责人\n    caliber_switches:\n      count_refund_orders: false\n    type_params:\n      numerator: repeat_member_count', '    dimensions:\n      - region\n      - member_tier\n    time_grains:\n      - month\n      - quarter\n    owner_role: 会员运营负责人\n    caliber_switches:\n      count_refund_orders: false\n    type_params:\n      numerator: repeat_member_count'));
  assert.throws(() => parseSapDraft(bytes), error => { assert.equal(fault(error).code, 'SAP_STRUCTURE'); return true; });
});

test('MF-01: wrong declared fingerprint is rejected', () => {
  const bytes = edited(text => text.replace('  fingerprint: ""', '  fingerprint: sha256:' + '0'.repeat(64)));
  assert.throws(() => parseSapDraft(bytes), error => { assert.equal(fault(error).code, 'SAP_FINGERPRINT_MISMATCH'); return true; });
});

test('MF-01: unknown fields are rejected', () => {
  const bytes = edited(text => text.replace('sap: "0.2"', 'sap: "0.2"\nbindings: []'));
  assert.throws(() => parseSapDraft(bytes), error => { assert.equal(fault(error).code, 'SAP_UNKNOWN_FIELD'); return true; });
});

test('MF-01: ratio metric without numerator and denominator is rejected', () => {
  const bytes = edited(text => text.replace('    type_params:\n      numerator: repeat_member_count\n      denominator: buyer_member_count', '    type_params:\n      window: 90d'));
  assert.throws(() => parseSapDraft(bytes), error => { assert.equal(fault(error).code, 'SAP_STRUCTURE'); return true; });
});

test('MF-01: duplicate metric identity is rejected', () => {
  const bytes = edited(text => text.replace('  - name: buyer_member_count', '  - name: repurchase_rate'));
  assert.throws(() => parseSapDraft(bytes), error => { assert.equal(fault(error).code, 'SAP_DUPLICATE_IDENTITY'); return true; });
});

test('MF-01: yaml anchors and aliases are rejected', () => {
  const bytes = edited(text => text.replace('dimensions:\n  - channel\n  - member_tier', 'dimensions: &dims\n  - channel\n  - member_tier').replace('    dimensions:\n      - channel\n      - member_tier\n    time_grains:\n      - month\n      - quarter', '    dimensions: *dims\n    time_grains:\n      - month\n      - quarter'));
  assert.throws(() => parseSapDraft(bytes), error => { assert.equal(fault(error).code, 'SAP_YAML_UNSAFE'); return true; });
});

test('MF-01: invalid encoding and oversize drafts are rejected', () => {
  assert.throws(() => parseSapDraft(new Uint8Array([0xff, 0xfe, 0x00, 0x01])), error => { assert.equal(fault(error).code, 'SAP_ENCODING'); return true; });
  const padded = edited(text => text.replace('definition: 窗口内至少完成一笔', `definition: ${'很长的口径说明。'.repeat(400_000)}窗口内至少完成一笔`));
  assert.throws(() => parseSapDraft(padded), error => { assert.equal(fault(error).code, 'SAP_FILE_SIZE'); return true; });
});

test('MF-01: fingerprints match canonical recomputation from the parsed document', () => {
  const publication = preparePublication(draftBytes());
  assert.deepEqual(sapFingerprints(publication.document), { packageFingerprint: publication.packageFingerprint, contentFingerprint: publication.contentFingerprint });
});
