'use strict';
window.FOUNDATION_DEMO = Object.freeze({
  enterprise: '示例企业 A（虚构）',
  project: '企业基础资产建设（演示项目）',
  packageId: 'demo-member-foundation',
  metricName: 'active_memberships',
  metricRef: 'demo-member-foundation@1.0.0::active_memberships',
  metricNextRef: 'demo-member-foundation@1.1.0::active_memberships',
  assets: [
    { id: 'md.program_membership', title: '会员关系', kind: '主数据模型', version: 'r1', summary: '一个账号或主体与一个会员计划之间，有起止时间和状态的资格关系。', fields: [['membership_id', 'text', '会员关系标识；在本企业命名空间唯一'], ['program_ref', 'ref', '引用准确会员计划'], ['member_ref', 'ref', '引用有依据的主体或账号，不推定自然人归并'], ['status', 'code', '正常／宽限／暂停／退出；以规则版本为准'], ['valid_from / valid_to', 'datetime?', '业务有效时间，与记录时间分别保留']], sources: '企业会员制度（虚构）r1 · §2；T02 会员领域参考 v0.2', relation: 'md.program_membership → 成员/计划 → md.party / md.account / md.member_program' },
    { id: 'sys.membership', title: '会员运营指标体系', kind: '指标体系索引', version: 'r1', summary: '按规模与发展、参与、权益、交易、服务组织指标引用。公式及场景定义仍由原 SAP 管理。', fields: [['主题', '会员规模与发展', '引用结果指标及已有场景'], ['指标引用', 'demo-member-foundation@1.0.0::active_memberships', '准确包版本＋指标名'], ['统计对象', 'md.program_membership', '计数粒度为会员关系，不等于自然人数'], ['其他主题', '参与／权益／交易／服务', '定义待核与数据缺口分别保留']], sources: 'T02 会员领域参考 v0.2；SAP 演示包 1.0.0', relation: '目录归属 ≠ 公式依赖 ≠ 统计分解 ≠ 已证明的因果关系' },
    { id: 'ont.membership', title: '会员资格与状态关系', kind: '本体', version: 'r1', summary: '表达主体、账号、会员关系、计划、状态规则及业务时间之间的含义。', fields: [['ProgramMembership → member', 'Party / Account', '成员身份由企业证据核定'], ['ProgramMembership → program', 'MemberProgram', '会员关系关联计划'], ['MembershipState → governedBy', 'RuleVersion', '状态有效性引用具体规则版本'], ['Metric → measures', 'ProgramMembership', '指标对象与主数据一致']], sources: '企业会员制度（虚构）r1 · §2；md.program_membership r1', relation: '图表示按需生成；图就绪不等于业务核定或实际使用' },
    { id: 'binding.crm', title: 'CRM 会员资格字段映射', kind: '数据映射', version: 'r1', summary: '记录会员关系键、状态、有效时间到获准样本字段的对应及检查。', fields: [['membership_id', 'crm_demo.membership_key', '已核样本唯一（演示）'], ['status', 'crm_demo.state_code', 'N=正常；G=宽限；S=暂停；E=退出'], ['valid_from / valid_to', 'start_at / end_at', '时区及起止边界按企业定义'], ['program_ref', 'program_code', '引用关系可追溯']], sources: 'CRM 字段字典（虚构）r1；数据样本 demo-snapshot-01', relation: '字段存在不等于业务口径正确；映射结果与规则核查分开' },
  ],
  references: [
    { id: 'T01', title: '运动鞋服行业', route: '行业 → 企业', type: '通用行业', file: '01-sportswear-industry.md', summary: '商品、品牌、渠道、门店与伙伴；经营指标主题；对象与事件关系。', evidence: '标准参考＋建模建议' },
    { id: 'T03', title: 'Nike 企业公开参考', route: '行业 → 企业', type: '标杆企业', file: '03-nike-enterprise-public.md', summary: '公开品牌、经营渠道和报告范围；公开指标与建议分别表达。', evidence: '公开事实／建模建议／未知' },
    { id: 'T02', title: '会员运营领域', route: '领域 → 部门', type: '通用领域', file: '02-membership-domain.md', summary: '会员身份、计划、权益及触点；会员指标主题；事件与规则。', evidence: '标准参考＋建模建议' },
    { id: 'T04', title: 'Nike 会员运营公开参考', route: '领域 → 部门', type: '标杆业务域', file: '04-nike-membership-public.md', summary: '地区化体验与权益；测量结构建议；内部部门与 KPI 未知。', evidence: '公开事实／建模建议／未知' },
  ],
  adaptation: [
    ['md.program_membership', '采用', '会员关系与账号分开', '会员制度 r1 §2（虚构）'],
    ['rule.membership_validity', '修改', '候选 r2：只计正常；原 r1 包含正常与宽限', '政策修订 r2 §3（受控虚构情境）'],
    ['optional.points_scheme', '排除', '本轮没有获准积分制度资料，保留可选项', '资料清单缺口 D-03'],
    ['md.store.membership_service', '新增', '记录门店服务资格范围', '门店服务说明 r1（虚构）'],
  ],
});
