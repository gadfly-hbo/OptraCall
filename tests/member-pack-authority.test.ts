import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthorizedDataView } from '../src/host/member-pack-data-view.ts';
import type { ResourceAuthorizationGrant } from '../extensions/business-plugins/studio/enterprise-pack.ts';

test('detail view uses exact store identity and covers the whole reported period', () => {
  const locator = '020_clean/authorized.csv';
  const grant: ResourceAuthorizationGrant = {
    id: 'synthetic-grant',
    enterpriseId: 'synthetic-enterprise',
    grantor: 'synthetic original authority',
    grantBasis: 'approved exact store and business days',
    subjectType: 'project',
    subjectId: 'synthetic-consumer',
    resourceKind: 'detail',
    operations: ['read-detail-recalculate'],
    purposeKeys: ['authorized-purpose'],
    scope: {
      allowedDataPaths: [locator],
      stores: ['湖庭直营店'],
      periodFrom: '2026-09-05',
      periodTo: '2026-09-25',
    },
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  };
  const bytes = Buffer.from([
    'order,store,period',
    'authorized,湖庭直营店,2026-09-25',
    'unqualified-branch,湖庭旗舰店,2026-09-06',
    'unqualified-period,湖庭直营店,2026-09',
    '',
  ].join('\n'));
  const view = buildAuthorizedDataView(bytes, locator, [grant], { purposeKey: 'authorized-purpose' });
  assert.ok(view.allowed);
  assert.equal(view.bytes.toString('utf8'), 'order,store,period\nauthorized,湖庭直营店,2026-09-25\n');
  assert.equal(buildAuthorizedDataView(bytes, locator, [grant], { purposeKey: 'other-purpose' }).allowed, false);
});

test('detail views enforce brand, channel, store and period within each single grant', () => {
  const scope = { brand: '织屿', channel: '直营', stores: ['湖庭店'], periodFrom: '2026-09-01' };
  const rows = [
    ['granted', '织屿', '直营', '湖庭店', '2026-09-05'],
    ['other-brand', '岚线', '直营', '湖庭店', '2026-09-05'],
    ['other-channel', '织屿', '联营', '湖庭店', '2026-09-05'],
    ['both-other', '岚线', '联营', '湖庭店', '2026-09-05'],
    ['unknown-brand', '', '直营', '湖庭店', '2026-09-05'],
    ['unknown-channel', '织屿', 'unknown', '湖庭店', '2026-09-05'],
    ['other-store', '织屿', '直营', '杉岸店', '2026-09-05'],
    ['outside-period', '织屿', '直营', '湖庭店', '2026-08-31'],
  ];
  const keys = ['order', '品牌', '渠道', '门店', '日期'];
  for (const ext of ['csv', 'tsv', 'json']) {
    const locator = `020_clean/mixed.${ext}`;
    const grant: ResourceAuthorizationGrant = {
      id: 'narrow', enterpriseId: 'fixture-enterprise', grantor: 'fixture-authority', grantBasis: 'fixture approval',
      subjectType: 'project', subjectId: 'fixture-project', resourceKind: 'detail', operations: ['read-detail-recalculate'],
      purposeKeys: ['repurchase'], scope: { ...scope, allowedDataPaths: [locator] },
      createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
    };
    const other = { ...grant, id: 'other', scope: { ...grant.scope, brand: '岚线', channel: '联营' } };
    const bytes = (columns: string[], data: string[][]) => Buffer.from(ext === 'json'
      ? JSON.stringify(data.map(row => Object.fromEntries(columns.map((key, index) => [key, row[index]]))))
      : [columns, ...data].map(row => row.join(ext === 'tsv' ? '\t' : ',')).join('\n'));
    const scoped = buildAuthorizedDataView(bytes(keys, rows), locator, [grant, other], { purposeKey: 'repurchase' });
    assert.ok(scoped.allowed, ext);
    assert.equal(scoped.keptRows, 2, ext);
    assert.equal(scoped.unattributableRows, 2, ext);
    const content = scoped.bytes.toString('utf8');
    assert.ok(content.includes('granted') && content.includes('both-other'), ext);
    for (const row of [1, 2, 4, 5, 6, 7]) assert.ok(!content.includes(rows[row]![0]!), ext);

    const withoutBrand = bytes(['order', '渠道', '门店', '日期'], [
      ['allowed-by-channel-store-period', '直营', '湖庭店', '2026-09-05'],
      ['other-channel-unknown-brand', '联营', '湖庭店', '2026-09-05'],
    ]);
    const denied = buildAuthorizedDataView(withoutBrand, locator, [grant], { purposeKey: 'repurchase' });
    assert.ok(!denied.allowed, ext);
    assert.equal(denied.code, 'authorized_view_unavailable_missing_brand_column', ext);
    const { brand: _brand, ...widerScope } = grant.scope;
    const wider = { ...grant, id: 'wider', scope: widerScope };
    const partial = buildAuthorizedDataView(withoutBrand, locator, [grant, wider], { purposeKey: 'repurchase' });
    assert.ok(partial.allowed, ext);
    assert.equal(partial.keptRows, 1, ext);
    assert.ok(!partial.bytes.toString('utf8').includes('other-channel-unknown-brand'), ext);

    const withoutChannel = bytes(['order', 'brand', 'store', 'period'], [
      ['missing-channel', '织屿', '湖庭店', '2026-09-05'],
    ]);
    const channelDenied = buildAuthorizedDataView(withoutChannel, locator, [grant], { purposeKey: 'repurchase' });
    assert.ok(!channelDenied.allowed, ext);
    assert.equal(channelDenied.code, 'authorized_view_unavailable_missing_channel_column', ext);

    const conflictingBrand = bytes([...keys, 'brand'], [
      ['valid-alias', '织屿', '直营', '湖庭店', '2026-09-05', '织屿'],
      ['invalid-alias', '织屿', '直营', '湖庭店', '2026-09-05', '岚线'],
    ]);
    const corroborated = buildAuthorizedDataView(conflictingBrand, locator, [grant], { purposeKey: 'repurchase' });
    assert.ok(corroborated.allowed, ext);
    assert.equal(corroborated.keptRows, 1, ext);
    assert.ok(!corroborated.bytes.toString('utf8').includes('invalid-alias'), ext);
  }
});
