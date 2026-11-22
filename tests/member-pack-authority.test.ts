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
