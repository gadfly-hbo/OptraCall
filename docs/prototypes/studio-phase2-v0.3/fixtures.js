'use strict';

// Entirely synthetic. Business-day timestamps are interpreted in Asia/Shanghai.
// No customer data or identifiers from a real enterprise are used.
function freezeFixture(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeFixture); Object.freeze(value); }
  return value;
}
const USAGE_FIXTURE = freezeFixture({
  id: 'A-MEMBER-SYNTHETIC-01', enterprise: 'A', permission: '仅此原型本地合成分析',
  historyCompleteness: '本合成企业于2026-01-01开始经营；fixture覆盖所列全部合成会员自开业以来的完整购买历史。此声明仅对本封闭合成案例有效。',
  sameDayAssumption: '本案例每名会员没有同日多笔不同购买；订单日期按当地零时处理，重复同步不产生新购买。',
  timezone: 'Asia/Shanghai', historyStart: '2026-01-01', cohortStart: '2026-09-01', cohortEndExclusive: '2026-11-01',
  cutoff: '2026-10-31T23:59:59+08:00', windowDays: 30, minimumComparableMembers: 3,
  shops: [{id:'S1',name:'青鹭站'},{id:'S2',name:'松渡站'},{id:'S3',name:'雁汀站'}],
  members: [
    {id:'M01',pos:'P01'},{id:'M02',pos:'P02'},{id:'M03',pos:'P03'},
    {id:'M04',pos:'P04'},{id:'M05',pos:'P05'},{id:'M06',pos:'P06'},
    {id:'M07',pos:'P07'},{id:'M08',pos:'P08'},{id:'M09',pos:'P09'},
    {id:'M10',pos:'P10'},{id:'M11',pos:'P11'},{id:'M12',pos:'P12'},
    {id:'M13',pos:'P13'},{id:'M14',pos:'P14'},{id:'M15',pos:'P15'},
    {id:'M16',pos:'P16'},{id:'M18',pos:'P18',internal:true},
  ],
  transactions: [
    {id:'O01',pos:'P01',shop:'S1',day:'2026-09-01',status:'paid',paidCents:10000},
    {id:'O02',pos:'P01',shop:'S1',day:'2026-09-10',status:'paid',paidCents:10000},
    {id:'O03',pos:'P02',shop:'S1',day:'2026-09-03',status:'paid',paidCents:10000},
    {id:'O04',pos:'P02',shop:'S1',day:'2026-10-12',status:'paid',paidCents:10000},
    {id:'O05',pos:'P03',shop:'S1',day:'2026-09-05',status:'paid',paidCents:10000},
    {id:'O06',pos:'P04',shop:'S1',day:'2026-09-07',status:'paid',paidCents:10000},
    {id:'O07',pos:'P04',shop:'S1',day:'2026-09-25',status:'paid',paidCents:10000},
    {id:'O08',pos:'P05',shop:'S1',day:'2026-09-09',status:'paid',paidCents:10000},
    {id:'O09',pos:'P05',shop:'S1',day:'2026-10-09',status:'paid',paidCents:10000},
    {id:'O10',pos:'P06',shop:'S1',day:'2026-10-20',status:'paid',paidCents:10000},
    {id:'O11',pos:'P07',shop:'S2',day:'2026-09-02',status:'paid',paidCents:10000},
    {id:'O12',pos:'P07',shop:'S1',day:'2026-09-18',status:'paid',paidCents:10000},
    {id:'O13',pos:'P08',shop:'S2',day:'2026-09-06',status:'paid',paidCents:10000},
    {id:'O14',pos:'P08',shop:'S2',day:'2026-09-20',status:'paid',paidCents:10000},
    {id:'O15',pos:'P09',shop:'S2',day:'2026-09-08',status:'paid',paidCents:10000},
    {id:'O16',pos:'P09',shop:'S2',day:'2026-10-01',status:'paid',paidCents:10000},
    {id:'O17',pos:'P10',shop:'S2',day:'2026-09-10',status:'paid',paidCents:10000},
    {id:'O18',pos:'P11',shop:'S2',day:'2026-09-11',status:'paid',paidCents:10000},
    {id:'O19',pos:'P12',shop:'S2',day:'2026-08-01',status:'paid',paidCents:10000},
    {id:'O20',pos:'P12',shop:'S2',day:'2026-09-12',status:'paid',paidCents:10000},
    {id:'O21',pos:'P13',shop:'S3',day:'2026-10-15',status:'paid',paidCents:10000},
    {id:'O22',pos:'P14',shop:'S3',day:'2026-10-17',status:'paid',paidCents:10000},
    {id:'O23',pos:'P15',shop:'S3',day:'2026-09-15',status:'paid',paidCents:10000},
    {id:'O24',pos:'P16',shop:'S3',day:'2026-09-18',status:'paid',paidCents:10000},
    {id:'O25',pos:'P16',shop:'S3',day:'2026-10-10',status:'cancelled',paidCents:0},
    {id:'O26',pos:'P99',shop:'S1',day:'2026-09-15',status:'paid',paidCents:10000},
    {id:'O27',pos:'P18',shop:'S1',day:'2026-09-16',status:'paid',paidCents:10000},
    // A synchronisation duplicate of O14, deliberately the same event identity.
    {id:'O14',pos:'P08',shop:'S2',day:'2026-09-20',status:'paid',paidCents:10000},
  ],
  refunds: [
    {id:'F01',order:'O02',day:'2026-09-11',status:'succeeded',amountCents:10000},
    {id:'F02',order:'O03',day:'2026-09-04',status:'succeeded',amountCents:10000},
    {id:'F03',order:'O07',day:'2026-09-26',status:'succeeded',amountCents:4000},
    {id:'F04',order:'O17',day:'2026-09-11',status:'failed',amountCents:10000},
    // The same successful refund event repeated by a source synchronisation.
    {id:'F01',order:'O02',day:'2026-09-11',status:'succeeded',amountCents:10000},
  ],
  policies: {
    '1.2.0': {id:'MET-MEMBER-01',version:'1.2.0',fullRefundCounts:true,sourceRevision:'2',text:'成功支付为有效购买；该版本未排除其后全额退款。企业首购，跨店复购归首购店；首购后30日为左闭右开观察窗，首购本身不算复购。'},
    '1.2.1': {id:'MET-MEMBER-01',version:'1.2.1',fullRefundCounts:true,sourceRevision:'2',text:'成功支付为有效购买；该合成小修订仍保留1.2.0退款处理。企业首购，跨店归首购店，观察窗30日。'},
    '1.3.0': {id:'MET-MEMBER-01',version:'1.3.0',fullRefundCounts:false,sourceRevision:'2',text:'截至数据截止已成功全额退款的订单不计有效购买，首购顺延；部分退款保留。企业首购，跨店复购归首购店；首购后30日为左闭右开观察窗，首购本身不算复购。'},
  },
});
