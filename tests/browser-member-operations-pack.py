#!/usr/bin/env python3
"""Isolated headless Chromium browser verification for Issue #111 Round-2 (Member Operations Enterprise Pack)."""
import json
import os
import shutil
import subprocess
import tempfile
import time
import urllib.request
import uuid as _uuid
from playwright.sync_api import sync_playwright

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
TMP_ROOT = tempfile.mkdtemp(prefix='optracall-member-pack-browser-')
DATA_ROOT = os.path.join(TMP_ROOT, 'data')
PROJECTS_ROOT = os.path.join(TMP_ROOT, 'projects')
UI_ROOT = os.path.join(REPO_ROOT, 'dist')

proc = None
try:
    env = os.environ.copy()
    env['OPTRACALL_HOST_ISOLATED'] = '1'
    proc = subprocess.Popen(
        [
            'node',
            os.path.join(REPO_ROOT, 'scripts', 'host-entry.mjs'),
            '--port=0',
            '--ui-port=4193',
            f'--data-root={DATA_ROOT}',
            f'--projects-root={PROJECTS_ROOT}',
            f'--ui-root={UI_ROOT}',
        ],
        cwd=REPO_ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    port = None
    deadline = time.time() + 15
    while time.time() < deadline:
        line = proc.stdout.readline()
        if not line:
            break
        try:
            payload = json.loads(line)
            if payload.get('kind') == 'host-ready':
                port = payload['port']
                break
        except Exception:
            pass
    if not port:
        raise RuntimeError(f'Host failed to start: {proc.stderr.read()}')

    base = f'http://127.0.0.1:{port}'
    headers = {'content-type': 'application/json', 'x-optracall-client': '1', 'origin': base}
    api_cookie = {'value': ''}

    def api(path, method='GET', body=None, cookie=None):
        req_headers = dict(headers)
        effective_cookie = api_cookie['value'] if cookie is None else cookie
        if effective_cookie:
            req_headers['cookie'] = effective_cookie
        req = urllib.request.Request(
            base + path,
            data=json.dumps(body).encode('utf-8') if body is not None else None,
            headers=req_headers,
            method=method,
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            sc = resp.headers.get('Set-Cookie') or ''
            if cookie is None and 'optracall_op_ctx=' in sc:
                api_cookie['value'] = sc.split(';')[0]
            return json.loads(resp.read().decode('utf-8'))

    # Seed minimal synthetic configuration, enterprise, project, system, and ONE real enabled Enterprise Material
    api('/api/configuration', 'PUT', {
        'name': 'Browser Synthetic',
        'provider': 'openai-compatible',
        'baseUrl': 'http://127.0.0.1:1/v1',
        'model': 'synthetic-browser',
        'apiKey': 'synthetic-only',
    })
    # Register authentic owner business operator `ops-lead` AND non-owner `store-analyst`
    api('/api/studio/operators/session', 'POST', {
        'action': 'register',
        'operatorId': 'store-analyst',
        'displayName': '门店分析师',
        'passcode': 'analyst-pass-2026',
    }, cookie='')
    api('/api/studio/operators/session', 'POST', {
        'action': 'register',
        'operatorId': 'ops-lead',
        'displayName': '会员运营负责人',
        'passcode': 'ops-pass-2026',
    })
    ent = api('/api/studio/enterprises', 'POST', {'name': '织屿服饰'})
    eid = ent['id']
    proj = api('/api/projects', 'POST', {'name': '织屿会员建设'})['project']
    api('/api/studio/enterprise-associations', 'POST', {'kind': 'project', 'entityId': proj['id'], 'enterpriseId': eid})

    mat = api('/api/enterprise-materials', 'POST', {
        'title': '织屿会员有效购买制度 v1',
        'body': '有效购买口径：单品牌会员账号口径，扣除全额退款订单。',
    })['material']
    enabled_mat = api(f"/api/enterprise-materials/{mat['id']}/enable", 'POST', {'expectedVersion': mat['version']})
    mat_rev = enabled_mat['material']['revisions'][0]
    api('/api/studio/enterprise-associations', 'POST', {
        'requestId': str(_uuid.uuid4()),
        'kind': 'asset',
        'authority': 'enterprise',
        'entityId': mat['id'],
        'enterpriseId': eid,
    })

    # Also create a second consumer project in the same enterprise to verify consumer read-only Grants view
    proj_consumer = api('/api/projects', 'POST', {'name': '门店分析项目（非原权责）'})['project']
    api('/api/studio/enterprise-associations', 'POST', {'kind': 'project', 'entityId': proj_consumer['id'], 'enterpriseId': eid})

    api('/api/studio/systems', 'POST', {
        'requestId': str(_uuid.uuid4()),
        'enterpriseId': eid,
        'name': '织屿会员运营体系',
        'projectId': proj['id'],
        'goal': '盘点会员运营现状并建设门店复购',
        'topicTitle': '会员运营',
    })

    errors = []
    captured_purposes_posts = []
    captured_message_posts = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1440, 'height': 900})
        page.on('pageerror', lambda err: errors.append(str(err)))
        def on_request(req):
            if req.method == 'POST' and req.url.endswith('/purposes'):
                try:
                    captured_purposes_posts.append(json.loads(req.post_data or '{}'))
                except Exception:
                    pass
            elif req.method == 'POST' and '/messages' in req.url:
                try:
                    captured_message_posts.append(json.loads(req.post_data or '{}'))
                except Exception:
                    pass
        page.on('request', on_request)
        page.goto(base, wait_until='networkidle')

        # 1. Open Settings -> 领域资产包
        page.get_by_role('button', name='设置').first.click()
        page.get_by_role('button', name='领域资产包').click()
        page.get_by_role('heading', name='领域资产包').wait_for(timeout=10_000)

        # Register Nike T03 repo template via UI button and verify verified original SHA-256
        page.get_by_role('button', name='登记 T03 · Nike 企业公开参考 T03 (v0.2)').click()
        page.get_by_text('原文可回查').first.wait_for(timeout=10_000)

        # Re-registering same T03 reports dedupe reuse (not duplicate row)
        page.get_by_role('button', name='登记 T03 · Nike 企业公开参考 T03 (v0.2)').click()
        page.get_by_text('复用原登记记录').wait_for(timeout=10_000)

        # Open original text drawer and verify SHA-256
        page.get_by_role('button', name='查看原文与摘要').first.click()
        page.get_by_text('8c64c78a30876c8607c5c32af78bed38e7b662b26354828dd3cd1097a15b4895').wait_for(timeout=10_000)
        page.get_by_role('button', name='关闭', exact=True).click()

        # 2. Jump directly into Enterprise Studio via "进入企业 Studio 建设"
        page.get_by_role('button', name='进入企业 Studio 建设').click()
        page.get_by_role('button', name='体系工作台').click()
        page.get_by_label('当前企业').select_option(eid)
        page.get_by_role('heading', name='企业会员运营资产包').wait_for(timeout=10_000)

        # Initialize Enterprise Member Pack from UI
        page.get_by_role('button', name='初始化本企业会员运营包').click()
        page.get_by_text('PACK-MEM-001').first.wait_for(timeout=10_000)

        # Look up registered T03 record ID for dual-route entry provenance
        refs = api('/api/studio/domain-references')['references']
        t03_rec = [r for r in refs if r['sourceId'] == 'T03'][0]
        mat_ref = {
            'authority': 'enterprise',
            'id': mat['id'],
            'version': mat_rev['revisionId'],
            'sha256': mat_rev['bodySha256'],
            'locator': enabled_mat['storeId'],
            'title': '织屿会员有效购买制度 v1',
        }

        # Seed panorama + dual-route entry + purposes via Host API (including Round-5 multi-scope same purposeKey: 杉岸直营 90日 + 湖庭直营 30日):
        packs = api(f'/api/studio/enterprise-packs?enterpriseId={eid}&domain=member-operations')['packs']
        pack_id = packs[0]['id']
        api(f'/api/studio/enterprise-packs/{pack_id}/panorama', 'POST', {
            'requestId': str(_uuid.uuid4()),
            'projectId': proj['id'],
            'goal': '盘点会员运营现状并规划首批建设用途',
            'brand': '织屿主品牌',
            'channel': '直营门店',
            'period': '2026-H1',
            'dataCutoffAt': '2026-06-30',
            'decisionPurpose': '确定首批会员留存与活跃用途',
            'sourceRefs': [mat_ref],
            'recommendations': [{
                'purposeKey': 'store-repurchase-90d',
                'title': '星桥与柳岸直营店 90 天门店复购率',
                'priorityReason': '直营门店核心复购议题',
                'deliverableNow': '星桥、柳岸两店受限计算试算',
                'minimumEvidence': '会员有效购买制度 v1',
                'ownerRole': '会员运营负责人',
                'completionCriteria': '经独立分析任务核对样本重算并通过',
                'selected': False,
            }, {
                'purposeKey': 'store-repurchase-multi',
                'title': '杉岸直营店 90 日门店复购率',
                'priorityReason': '杉岸直营 90 日长周期复购',
                'deliverableNow': '杉岸直营店 90 日受限试算',
                'minimumEvidence': '会员有效购买制度 v1',
                'ownerRole': '会员运营负责人',
                'completionCriteria': '杉岸 90 日样本核对通过',
                'scopeKey': 'zhiyu:shanan:90d',
                'windowDays': 90,
                'stores': ['杉岸直营店'],
                'selected': False,
            }, {
                'purposeKey': 'store-repurchase-multi',
                'title': '湖庭直营店 30 日门店复购率',
                'priorityReason': '湖庭直营 30 日短周期复购',
                'deliverableNow': '湖庭直营店 30 日受限试算',
                'minimumEvidence': '会员有效购买制度 v1',
                'ownerRole': '会员运营负责人',
                'completionCriteria': '湖庭 30 日样本核对通过',
                'scopeKey': 'zhiyu:huting:30d',
                'windowDays': 30,
                'stores': ['湖庭直营店'],
                'selected': False,
            }, {
                'purposeKey': 'store-repurchase-single-vs-two',
                'title': '湖庭单店 30 日门店复购率',
                'priorityReason': '仅聚焦湖庭单店 30 日复购，不可扩大到湖庭与杉岸两店',
                'deliverableNow': '湖庭单店 30 日受限试算',
                'minimumEvidence': '湖庭单店订单明细',
                'ownerRole': '会员运营负责人',
                'completionCriteria': '输出湖庭单店 30 日复购分子分母',
                'selected': False,
            }],
            'issues': [],
            'pendingQuestions': [],
        })
        api(f'/api/studio/enterprise-packs/{pack_id}/entries', 'POST', {
            'requestId': str(_uuid.uuid4()),
            'projectId': proj['id'],
            'entryKey': 'repurchase-valid-order',
            'title': '有效再购与全额退款冲销规则',
            'action': 'modify',
            'routes': ['enterprise', 'domain'],
            'enterpriseBasis': '依据织屿制度 v1 扣除全额退款，并参考 T03 标杆界定退货边界',
            'decisionOwner': '张明（会员运营负责人）',
            'enterpriseSourceRefs': [mat_ref],
            'referenceLinks': [{
                'refId': t03_rec['id'],
                'sourceId': t03_rec['sourceId'],
                'version': t03_rec['version'],
                'sectionLocator': '1-5',
                'evidenceNature': 'public-benchmark',
                'excerpt': 'Nike T03 前5行摘要',
            }],
            'scope': '织屿主品牌直营门店',
            'impactedPurposeIds': [],
            'exceptions': [],
        })
        api(f'/api/studio/enterprise-packs/{pack_id}/purposes', 'POST', {
            'requestId': str(_uuid.uuid4()),
            'projectId': proj['id'],
            'purposeKey': 'store-repurchase-90d',
            'title': '星桥与柳岸直营店 90 天门店复购率',
            'businessQuestion': '如何准确计算直营两店 90 天门店复购率？',
            'limitedCalculationName': '直营门店90天复购率（两店试算版）',
            'tier': 'limited-calculation',
            'businessStatus': 'active',
            'subjectUnit': 'brand_account',
            'scope': {'scopeKey': 'zhiyu:direct:two-stores:2026-H1', 'brand': '织屿主品牌', 'channel': '直营门店', 'stores': ['星桥直营店', '柳岸直营店'], 'period': '2026-H1'},
            'windowDays': 90,
            'originalGoal': '核算全品牌 90 天门店复购率',
            'deliveredSubset': '当前仅在星桥、柳岸两家直营店按单品牌会员账号试算',
            'completionCriteria': '经独立分析任务核对样本重算并通过',
            'evidenceReadiness': {'definition': 'pass', 'mapping': 'pass', 'sampleCalculation': 'pass'},
            'policyEffectiveFrom': '2026-01-01',
            'dataCutoffAt': '2026-06-30',
            'observationWindowDays': 90,
            'availableHistoryDays': 120,
            'exclusions': ['全额退款订单', '未打通跨品牌账号'],
            'remainingGaps': ['华东加盟店明细未纳入'],
            'decisionChoices': [{
                'id': 'cross-store',
                'question': '跨店复购归属口径',
                'options': [
                    {'key': 'first-store', 'label': '归首购门店（同城跨店计复购）', 'impact': '星桥首购+柳岸复购计入星桥'},
                    {'key': 'same-store-only', 'label': '仅同店复购', 'impact': '跨店不计入'},
                ],
            }],
            'dependencies': [{
                'id': 'dep-sap-fake',
                'role': 'sap-metric',
                'authority': 'sap-metric',
                'ref': {
                    'authority': 'sap-metric',
                    'id': 'MET-FAKE-BROWSER-999',
                    'version': '9.9.9',
                    'sha256': 'a' * 64,
                    'title': '不存在的90天复购指标',
                },
                'requiredFor': ['limited-calculation'],
            }],
        })
        api(f'/api/studio/enterprise-packs/{pack_id}/purposes', 'POST', {
            'requestId': str(_uuid.uuid4()),
            'projectId': proj['id'],
            'purposeKey': 'member-valid-order-def',
            'title': '会员有效购买口径定义',
            'businessQuestion': '如何定义单品牌会员有效购买？',
            'tier': 'definition-reference',
            'businessStatus': 'active',
            'subjectUnit': 'brand_account',
            'scope': {'scopeKey': 'zhiyu:direct:all:def', 'brand': '织屿主品牌', 'channel': '直营门店'},
            'originalGoal': '明确单品牌会员有效购买定义',
            'completionCriteria': '关联真实启用企业资料',
            'evidenceReadiness': {'definition': 'pass'},
            'policyEffectiveFrom': '2026-01-01',
            'dataCutoffAt': '2026-06-30',
            'exclusions': ['全额退款订单'],
            'remainingGaps': [],
            'dependencies': [{
                'id': 'dep-ent-real',
                'role': 'member-rule',
                'authority': 'enterprise',
                'ref': mat_ref,
                'requiredFor': ['definition-reference'],
            }],
        })
        shanan_purpose = api(f'/api/studio/enterprise-packs/{pack_id}/purposes', 'POST', {
            'requestId': str(_uuid.uuid4()),
            'projectId': proj['id'],
            'purposeKey': 'store-repurchase-multi',
            'title': '杉岸直营店 90 日门店复购率',
            'businessQuestion': '如何计算杉岸直营店 90 日门店复购率？',
            'limitedCalculationName': '杉岸直营店90日复购率（试算版）',
            'tier': 'limited-calculation',
            'businessStatus': 'active',
            'subjectUnit': 'brand_account',
            'scope': {'scopeKey': 'zhiyu:shanan:90d', 'brand': '织屿主品牌', 'channel': '直营门店', 'stores': ['杉岸直营店'], 'period': '2026-H1'},
            'windowDays': 90,
            'originalGoal': '核算杉岸直营店 90 日复购率',
            'completionCriteria': '杉岸 90 日样本核对通过',
            'evidenceReadiness': {'definition': 'pass', 'mapping': 'pass', 'sampleCalculation': 'pass'},
            'policyEffectiveFrom': '2026-01-01',
            'dataCutoffAt': '2026-06-30',
            'observationWindowDays': 90,
            'availableHistoryDays': 120,
            'exclusions': ['全额退款订单'],
            'remainingGaps': [],
            'dependencies': [{
                'id': 'dep-shanan-ent',
                'role': 'member-rule',
                'authority': 'enterprise',
                'ref': mat_ref,
                'requiredFor': ['limited-calculation'],
            }],
        })['purpose']
        huting_purpose = api(f'/api/studio/enterprise-packs/{pack_id}/purposes', 'POST', {
            'requestId': str(_uuid.uuid4()),
            'projectId': proj['id'],
            'purposeKey': 'store-repurchase-multi',
            'title': '湖庭直营店 30 日门店复购率',
            'businessQuestion': '如何计算湖庭直营店 30 日门店复购率？',
            'limitedCalculationName': '湖庭直营店30日复购率（试算版）',
            'tier': 'limited-calculation',
            'businessStatus': 'active',
            'subjectUnit': 'brand_account',
            'scope': {'scopeKey': 'zhiyu:huting:30d', 'brand': '织屿主品牌', 'channel': '直营门店', 'stores': ['湖庭直营店'], 'period': '2026-H1'},
            'windowDays': 30,
            'originalGoal': '核算湖庭直营店 30 日复购率',
            'completionCriteria': '湖庭 30 日样本核对通过',
            'evidenceReadiness': {'definition': 'pass', 'mapping': 'pass', 'sampleCalculation': 'pass'},
            'policyEffectiveFrom': '2026-01-01',
            'dataCutoffAt': '2026-06-30',
            'observationWindowDays': 30,
            'availableHistoryDays': 120,
            'exclusions': ['全额退款订单'],
            'remainingGaps': [],
            'dependencies': [{
                'id': 'dep-huting-ent',
                'role': 'member-rule',
                'authority': 'enterprise',
                'ref': mat_ref,
                'requiredFor': ['limited-calculation'],
            }],
        })['purpose']
        two_store_purpose = api(f'/api/studio/enterprise-packs/{pack_id}/purposes', 'POST', {
            'requestId': str(_uuid.uuid4()),
            'projectId': proj['id'],
            'purposeKey': 'store-repurchase-single-vs-two',
            'title': '湖庭与杉岸两店 30 日门店复购率',
            'businessQuestion': '如何计算湖庭与杉岸两店合并 30 日复购率？',
            'limitedCalculationName': '湖庭及杉岸两店30日复购率（试算版）',
            'tier': 'limited-calculation',
            'businessStatus': 'active',
            'subjectUnit': 'brand_account',
            'scope': {'scopeKey': 'zhiyu:huting-shanan:30d', 'brand': '织屿主品牌', 'channel': '直营门店', 'stores': ['湖庭直营店', '杉岸直营店'], 'period': '2026-H1'},
            'windowDays': 30,
            'originalGoal': '核算湖庭与杉岸两店 30 日复购率',
            'completionCriteria': '两店 30 日样本核对通过',
            'evidenceReadiness': {'definition': 'pass', 'mapping': 'pass', 'sampleCalculation': 'pass'},
            'policyEffectiveFrom': '2026-01-01',
            'dataCutoffAt': '2026-06-30',
            'observationWindowDays': 30,
            'availableHistoryDays': 120,
            'exclusions': ['全额退款订单'],
            'remainingGaps': [],
            'dependencies': [{
                'id': 'dep-two-store-ent',
                'role': 'member-rule',
                'authority': 'enterprise',
                'ref': mat_ref,
                'requiredFor': ['limited-calculation'],
            }],
        })['purpose']

        # R3 (Round-7 exact Codex counterexample): Re-save panorama adding a 5th recommendation that
        # explicitly asks for 湖庭单店 30日 YET carries contradictory targetPurposeId=two_store_purpose['id']!
        api(f'/api/studio/enterprise-packs/{pack_id}/panorama', 'POST', {
            'requestId': str(_uuid.uuid4()),
            'projectId': proj['id'],
            'goal': '盘点会员运营现状并规划首批建设用途',
            'brand': '织屿主品牌',
            'channel': '直营门店',
            'period': '2026-H1',
            'dataCutoffAt': '2026-06-30',
            'decisionPurpose': '确定首批会员留存与活跃用途',
            'sourceRefs': [mat_ref],
            'recommendations': [{
                'purposeKey': 'store-repurchase-90d',
                'title': '星桥与柳岸直营店 90 天门店复购率',
                'priorityReason': '直营门店核心复购议题',
                'deliverableNow': '星桥、柳岸两店受限计算试算',
                'minimumEvidence': '会员有效购买制度 v1',
                'ownerRole': '会员运营负责人',
                'completionCriteria': '经独立分析任务核对样本重算并通过',
                'selected': False,
            }, {
                'purposeKey': 'store-repurchase-multi',
                'title': '杉岸直营店 90 日门店复购率',
                'priorityReason': '杉岸直营 90 日长周期复购',
                'deliverableNow': '杉岸直营店 90 日受限试算',
                'minimumEvidence': '会员有效购买制度 v1',
                'ownerRole': '会员运营负责人',
                'completionCriteria': '杉岸 90 日样本核对通过',
                'scopeKey': 'zhiyu:shanan:90d',
                'windowDays': 90,
                'stores': ['杉岸直营店'],
                'selected': False,
            }, {
                'purposeKey': 'store-repurchase-multi',
                'title': '湖庭直营店 30 日门店复购率',
                'priorityReason': '湖庭直营 30 日短周期复购',
                'deliverableNow': '湖庭直营店 30 日受限试算',
                'minimumEvidence': '会员有效购买制度 v1',
                'ownerRole': '会员运营负责人',
                'completionCriteria': '湖庭 30 日样本核对通过',
                'scopeKey': 'zhiyu:huting:30d',
                'windowDays': 30,
                'stores': ['湖庭直营店'],
                'selected': False,
            }, {
                'purposeKey': 'store-repurchase-single-vs-two',
                'title': '湖庭单店 30 日门店复购率',
                'priorityReason': '仅聚焦湖庭单店 30 日复购，不可扩大到湖庭与杉岸两店',
                'deliverableNow': '湖庭单店 30 日受限试算',
                'minimumEvidence': '湖庭单店订单明细',
                'ownerRole': '会员运营负责人',
                'completionCriteria': '输出湖庭单店 30 日复购分子分母',
                'selected': False,
            }, {
                'purposeKey': 'store-repurchase-single-vs-two',
                'targetPurposeId': two_store_purpose['id'],
                'title': '湖庭单店 30 日门店复购率（带冲突两店标识）',
                'priorityReason': '仅做湖庭单店 30 日复购，不可扩大为两店',
                'deliverableNow': '湖庭单店 30 日受限试算',
                'minimumEvidence': '湖庭单店订单明细',
                'ownerRole': '会员运营负责人',
                'completionCriteria': '输出湖庭单店 30 日复购分子分母',
                'selected': False,
            }],
            'issues': [],
            'pendingQuestions': [],
        })

        # Reload page: most recently created project (proj_consumer) is active by default!
        # First verify R2 in real Chromium: consumer project gets read-only Grants view with NO grant creation form!
        page.reload(wait_until='networkidle')
        page.get_by_role('button', name='设置').first.click()
        page.get_by_role('button', name='领域资产包').click()
        page.get_by_text('原文可回查').first.wait_for(timeout=10_000)
        page.get_by_role('button', name='进入企业 Studio 建设').click()
        page.get_by_role('button', name='体系工作台').click()
        page.get_by_label('当前企业').select_option(eid)
        page.get_by_role('heading', name='企业会员运营资产包').wait_for(timeout=10_000)
        page.get_by_role('button', name='三层资源授权 (0)').click()
        page.get_by_text('当前操作者或项目不是该企业包/体系的原权责维护主体').wait_for(timeout=10_000)
        assert page.get_by_role('heading', name='新增项目资源授权').count() == 0, 'Non-owner consumer project MUST NOT render grant creation form!'

        # Now switch active project in sidebar to the authentic owner project (织屿会员建设) and re-enter Studio workbench
        page.get_by_role('button', name='织屿会员建设', exact=True).click()
        page.get_by_role('button', name='设置').first.click()
        page.get_by_role('button', name='领域资产包').click()
        page.get_by_role('button', name='进入企业 Studio 建设').click()
        page.get_by_role('button', name='体系工作台').click()
        page.get_by_label('当前企业').select_option(eid)
        page.get_by_role('heading', name='企业会员运营资产包').wait_for(timeout=10_000)
        page.get_by_role('button', name='覆盖与全景').click()

        # R3 (Round-7 exact Codex counterexample): Clicking 湖庭单店 30日 recommendation WITH contradictory targetPurposeId=two_store_purpose['id']
        # MUST NOT silently hand off two_store_purpose to Agent — MUST display conflict picker with ZERO automatic POST /purposes or /messages!
        captured_purposes_posts.clear()
        captured_message_posts.clear()
        conflict_card = page.locator('article', has_text='湖庭单店 30 日门店复购率（带冲突两店标识）').first
        conflict_card.wait_for(timeout=10_000)
        conflict_card.get_by_role('button', name='按此建议携带原范围续建').click()
        page.wait_for_timeout(500)
        assert len(captured_purposes_posts) == 0, f'Contradictory targetPurposeId MUST NOT auto-POST /purposes! Got: {captured_purposes_posts}'
        assert len(captured_message_posts) == 0, f'Contradictory targetPurposeId MUST NOT auto-dispatch message to Agent! Got: {captured_message_posts}'
        conflict_card.get_by_role('region', name='用途标识与建议范围冲突').wait_for(timeout=10_000)
        conflict_card.get_by_text('门店范围不一致').wait_for(timeout=10_000)
        # User explicitly clicks "按建议原范围新建独立用途" -> creates isolated 湖庭直营店 30日 without touching two_store_purpose!
        conflict_card.get_by_role('button', name='按建议原范围新建独立用途').click()
        page.wait_for_timeout(1_000)
        assert len(captured_purposes_posts) >= 1, 'Expected explicit create-isolated-purpose POST /purposes'
        conflict_upsert = captured_purposes_posts[-1]
        assert conflict_upsert.get('targetPurposeId') is None, f'Explicit isolated creation MUST have targetPurposeId=None, got {conflict_upsert.get("targetPurposeId")}'
        assert conflict_upsert.get('windowDays') == 30
        assert conflict_upsert.get('scope', {}).get('stores') == ['湖庭直营店']
        if captured_message_posts:
            conflict_handoff = str(captured_message_posts[-1].get('text', ''))
            assert '湖庭直营店' in conflict_handoff and '30日' in conflict_handoff
            assert two_store_purpose['id'] not in conflict_handoff and '杉岸直营店' not in conflict_handoff

        # Return to 覆盖与缺口 -> 覆盖与全景 for the remaining R3 checks
        page.get_by_role('region', name='资料、资产与建设记录').wait_for(timeout=10_000)
        page.get_by_role('navigation', name='体系工作台视图').get_by_role('button', name='覆盖与缺口').click()
        page.get_by_role('heading', name='企业会员运营资产包').wait_for(timeout=10_000)
        page.get_by_role('button', name='覆盖与全景').click()

        # R3 (Round-5): Multi-scope same purposeKey (杉岸直营 90日 + 湖庭直营 30日):
        # Clicking 湖庭直营店 30日 recommendation MUST target 湖庭直营店 30日 and hand off 湖庭 30日 to Agent (NEVER 杉岸 90日)!
        captured_purposes_posts.clear()
        captured_message_posts.clear()
        huting_card = page.locator('article', has_text='湖庭直营店 30 日门店复购率').first
        huting_card.wait_for(timeout=10_000)
        huting_card.get_by_role('button', name='按此建议携带原范围续建').click()
        page.wait_for_timeout(1_000)
        assert len(captured_purposes_posts) >= 1, 'Expected browser to POST purpose continuation upsert'
        last_upsert = captured_purposes_posts[-1]
        assert last_upsert.get('targetPurposeId') == huting_purpose['id'], f"Expected targetPurposeId={huting_purpose['id']} (湖庭30日), got {last_upsert.get('targetPurposeId')}!"
        assert last_upsert.get('windowDays') == 30, f"Expected windowDays=30 (湖庭30日), got {last_upsert.get('windowDays')}!"
        assert last_upsert.get('scope', {}).get('stores') == ['湖庭直营店'], f"Expected stores=['湖庭直营店'], got {last_upsert.get('scope')}!"
        if captured_message_posts:
            handoff_text = str(captured_message_posts[-1].get('text', ''))
            assert huting_purpose['id'] in handoff_text and '湖庭直营店' in handoff_text and '30日' in handoff_text, f'Agent handoff MUST carry 湖庭 30日, got: {handoff_text}'
            assert shanan_purpose['id'] not in handoff_text and '杉岸直营店' not in handoff_text, f'Agent handoff MUST NOT mention 杉岸 90日, got: {handoff_text}'

        # Return to 覆盖与缺口 -> 覆盖与全景 and verify Round-6 exact Codex counterexample:
        # Clicking 湖庭单店 30日 recommendation (which now matches the exact isolated 湖庭单店 30日 purpose created above) MUST NEVER attach to existing 湖庭与杉岸两店 30日 superset!
        page.get_by_role('region', name='资料、资产与建设记录').wait_for(timeout=10_000)
        page.get_by_role('navigation', name='体系工作台视图').get_by_role('button', name='覆盖与缺口').click()
        page.get_by_role('heading', name='企业会员运营资产包').wait_for(timeout=10_000)
        page.get_by_role('button', name='覆盖与全景').click()

        captured_purposes_posts.clear()
        captured_message_posts.clear()
        single_huting_card = page.locator('article', has_text='仅聚焦湖庭单店 30 日复购，不可扩大到湖庭与杉岸两店').first
        single_huting_card.wait_for(timeout=10_000)
        single_huting_card.get_by_role('button', name='按此建议携带原范围续建').click()
        page.wait_for_timeout(1_000)
        assert len(captured_purposes_posts) >= 1, 'Expected browser to POST single-store purpose upsert'
        single_upsert = captured_purposes_posts[-1]
        assert single_upsert.get('targetPurposeId') != two_store_purpose['id'], f"Single-store 湖庭单店 30日 MUST NEVER attach to two-store purpose {two_store_purpose['id']}!"
        assert single_upsert.get('windowDays') == 30, f"Expected windowDays=30, got {single_upsert.get('windowDays')}!"
        assert single_upsert.get('scope', {}).get('stores') == ['湖庭直营店'], f"Expected extracted single store ['湖庭直营店'], got {single_upsert.get('scope')}!"
        if captured_message_posts:
            single_handoff = str(captured_message_posts[-1].get('text', ''))
            assert '湖庭直营店' in single_handoff and '30日' in single_handoff, f'Single-store handoff MUST carry 湖庭直营店 30日, got: {single_handoff}'
            assert two_store_purpose['id'] not in single_handoff and '杉岸直营店' not in single_handoff, f'Single-store handoff MUST NOT expand to 杉岸直营店 or two-store purpose, got: {single_handoff}'

        # Return to 覆盖与缺口 and verify backend kept exact 6 purposes (5 seeded + 1 new single-store) and 杉岸 90日 & 湖庭与杉岸两店 30日 are 100% untouched!
        page.get_by_role('region', name='资料、资产与建设记录').wait_for(timeout=10_000)
        page.get_by_role('navigation', name='体系工作台视图').get_by_role('button', name='覆盖与缺口').click()
        page.get_by_role('heading', name='企业会员运营资产包').wait_for(timeout=10_000)
        pack_after_huting = api(f'/api/studio/enterprise-packs/{pack_id}')['pack']
        assert len(pack_after_huting['purposes']) == 6, f"Expected exact 6 purposes (5 seeded + 1 new single-store 湖庭30日), got {len(pack_after_huting['purposes'])}"
        shanan_after = [p for p in pack_after_huting['purposes'] if p['id'] == shanan_purpose['id']][0]
        huting_after = [p for p in pack_after_huting['purposes'] if p['id'] == huting_purpose['id']][0]
        two_store_after = [p for p in pack_after_huting['purposes'] if p['id'] == two_store_purpose['id']][0]
        assert shanan_after['windowDays'] == 90 and shanan_after['scope'].get('stores') == ['杉岸直营店']
        assert huting_after['windowDays'] == 30 and huting_after['scope'].get('stores') == ['湖庭直营店']
        assert two_store_after['windowDays'] == 30 and two_store_after['scope'].get('stores') == ['湖庭直营店', '杉岸直营店']

        # Also verify single-match continuation (星桥与柳岸 90天) updates selection toast and preserves stores/window/deps
        page.get_by_text('星桥与柳岸直营店 90 天门店复购率').first.wait_for(timeout=10_000)
        page.get_by_role('checkbox', name='星桥与柳岸直营店 90 天门店复购率').click()
        page.get_by_text('已将建议「星桥与柳岸直营店 90 天门店复购率」选入本轮建设范围。').wait_for(timeout=10_000)
        page.get_by_role('button', name='按此建议携带原范围续建').first.click()
        page.wait_for_timeout(800)
        pack_after_cont = api(f'/api/studio/enterprise-packs/{pack_id}')['pack']
        assert len(pack_after_cont['purposes']) == 6, f"Expected 6 purposes without duplicate, got {len(pack_after_cont['purposes'])}"
        p90 = [p for p in pack_after_cont['purposes'] if p['purposeKey'] == 'store-repurchase-90d'][0]
        assert p90['windowDays'] == 90, f"Expected windowDays=90 preserved, got {p90.get('windowDays')}"
        assert p90['scope'].get('stores') == ['星桥直营店', '柳岸直营店'], f"Expected stores preserved, got {p90['scope']}"
        assert p90['tier'] == 'limited-calculation', f"Expected tier preserved, got {p90['tier']}"
        assert len(p90['dependencies']) == 1, f"Expected dependencies preserved, got {p90['dependencies']}"

        # Verify handoff into Studio construction view (建设与演进) and return via top workbench 覆盖与缺口 -> 建设草案 (1 条 / 6 用途)
        page.get_by_role('region', name='资料、资产与建设记录').wait_for(timeout=10_000)
        page.get_by_role('navigation', name='体系工作台视图').get_by_role('button', name='覆盖与缺口').click()
        page.get_by_role('heading', name='企业会员运营资产包').wait_for(timeout=10_000)
        page.get_by_role('button', name='建设草案 (1 条 / 6 用途)').click()
        page.get_by_text('直营门店90天复购率（两店试算版）').first.wait_for(timeout=10_000)

        # R3.2: Verify dual-route draft provenance (Route 1 enterprise source + Route 2 reference link) & clickable "查看参考原段" excerpt drawer!
        page.get_by_text('企业线依据：').wait_for(timeout=10_000)
        page.get_by_text('领域/行业参考原段：').wait_for(timeout=10_000)
        page.get_by_role('button', name='查看参考原段').first.click()
        page.get_by_text('参考原段回查').first.wait_for(timeout=10_000)
        page.get_by_text('第 1-5 行').wait_for(timeout=10_000)
        page.get_by_role('button', name='关闭', exact=True).click()

        # Explicitly choose option + decider in UI (no silent fallback!)
        page.get_by_label('跨店复购归属口径', exact=True).select_option('first-store')
        page.get_by_label('跨店复购归属口径决定人').fill('张明（会员运营负责人）')

        page.get_by_role('button', name='生成一份发布预览').click()
        page.get_by_role('heading', name='确认发布预览 · v1.0').wait_for(timeout=10_000)
        page.get_by_label('确认发布人（可选，不伪造默认角色）').fill('张明（会员运营负责人）')
        page.get_by_role('button', name='确认并按用途发布').click()
        page.get_by_text('当前发布版 v1.0').wait_for(timeout=10_000)

        # Verify REAL authority outcomes in Chromium UI:
        # - Nonexistent SAP metric MUST show failed receipt & suspended purpose (NOT succeeded / eligible!)
        # - Real enabled enterprise material MUST show succeeded receipt & eligible purpose!
        page.get_by_text('suspended').first.wait_for(timeout=10_000)
        page.get_by_text('eligible').first.wait_for(timeout=10_000)
        page.get_by_text('failed').first.wait_for(timeout=10_000)
        page.get_by_text('succeeded').first.wait_for(timeout=10_000)

        # Clicking read-only reconcile against nonexistent SAP metric MUST keep it failed & suspended!
        page.get_by_role('button', name='只读查原权威并核对').first.click()
        page.get_by_text('当前结果仍为 failed').wait_for(timeout=10_000)
        page.get_by_text('未强行恢复').wait_for(timeout=10_000)
        page.get_by_text('suspended').first.wait_for(timeout=10_000)

        # 3. R2 (Round-7): Verify real-product browser operator isolation + Host operator authentication switcher!
        page.get_by_role('button', name='三层资源授权 (0)').click()
        # 3a. Before authenticating as `ops-lead`, this fresh browser session MUST NOT obtain grantAuthority!
        page.get_by_text('当前操作者或项目不是该企业包/体系的原权责维护主体').wait_for(timeout=10_000)
        assert page.get_by_role('heading', name='新增项目资源授权').count() == 0, 'Unauthenticated/non-owner browser session MUST NOT see grant creation form!'

        # 3b. Authenticate as authentic owner `ops-lead` via Host operator switcher UI -> grant creation form appears!
        page.get_by_label('业务操作者标识').fill('ops-lead')
        page.get_by_label('操作者口令').fill('ops-pass-2026')
        page.get_by_role('button', name='注册/切换认证操作者').click()
        page.get_by_text('已切换 Host 认证操作者：会员运营负责人（op:ops-lead）').wait_for(timeout=10_000)
        page.get_by_role('heading', name='新增项目资源授权').wait_for(timeout=10_000)

        # Create (with Host-issued cryptographic authorityToken for authentic owner op:ops-lead & allowedDataPaths) and revoke a resource grant from UI
        page.get_by_label('被授权项目').select_option(proj_consumer['id'])
        page.get_by_label('最高操作层次').select_option('read-detail-recalculate')
        page.get_by_label('允许读取的门店（顿号或逗号分隔）').fill('星桥直营店')
        page.get_by_label('允许读取的 020_clean 路径（顿号或逗号分隔）').fill('020_clean/starbridge_orders.csv')
        page.get_by_role('button', name='保存资源授权').click()
        page.get_by_text('原权责项目').first.wait_for(timeout=10_000)
        page.get_by_role('cell', name='门店：星桥直营店 · 路径：020_clean/starbridge_orders.csv').wait_for(timeout=10_000)
        page.get_by_role('button', name='撤回授权').first.click()
        page.get_by_text('已撤回').first.wait_for(timeout=10_000)

        # 3c. Switch to non-owner operator `store-analyst` -> grant creation form IMMEDIATELY disappears!
        page.get_by_label('业务操作者标识').fill('store-analyst')
        page.get_by_label('操作者口令').fill('analyst-pass-2026')
        page.get_by_role('button', name='注册/切换认证操作者').click()
        page.get_by_text('已切换 Host 认证操作者：门店分析师（op:store-analyst）').wait_for(timeout=10_000)
        page.get_by_text('当前操作者或项目不是该企业包/体系的原权责维护主体').wait_for(timeout=10_000)
        assert page.get_by_role('heading', name='新增项目资源授权').count() == 0, 'Non-owner operator MUST NOT see grant creation form!'

        # 3d. Completely separate second browser context opens the same URL (and selects owner project 织屿会员建设!) -> STILL read-only Grants view, NO grant form!
        ctx2 = browser.new_context(viewport={'width': 1440, 'height': 900})
        page2 = ctx2.new_page()
        page2.on('pageerror', lambda err: errors.append(f'ctx2: {err}'))
        page2.goto(base, wait_until='networkidle')
        page2.get_by_role('button', name='织屿会员建设', exact=True).click()
        page2.get_by_role('button', name='设置').first.click()
        page2.get_by_role('button', name='领域资产包').click()
        page2.get_by_role('button', name='进入企业 Studio 建设').click()
        page2.get_by_role('button', name='体系工作台').click()
        page2.get_by_label('当前企业').select_option(eid)
        page2.get_by_role('heading', name='企业会员运营资产包').wait_for(timeout=10_000)
        page2.get_by_role('button', name='三层资源授权 (0)').click()
        page2.get_by_text('当前操作者或项目不是该企业包/体系的原权责维护主体').wait_for(timeout=10_000)
        assert page2.get_by_role('heading', name='新增项目资源授权').count() == 0, 'Second isolated browser context MUST NOT obtain owner grantAuthority!'
        ctx2.close()

        browser.close()

    if errors:
        raise RuntimeError(f'Browser page errors observed: {errors}')
    print('BROWSER_MEMBER_PACK_E2E: PASS (Round-7: Settings T03 SHA-256 + Dedupe + Drawer -> Contradictory targetPurposeId Conflict Picker & Explicit Isolated Creation -> Multi-Scope Disambiguation [杉岸 90日 vs 湖庭 30日] + Single-Store vs Two-Store Isolation -> Dual-Route Entry Provenance & Reference Excerpt Drawer -> Explicit Decision/Decider -> Preview -> Real Authority Confirm [Nonexistent SAP=failed/suspended + Read-Only Reconcile Stays Failed; Real Enterprise Material=succeeded/eligible] -> Real-Product Operator Session Isolation & Host Operator Auth Switcher [unauth/non-owner/ctx2 denied; ops-lead grants/revokes], 0 page errors)')
finally:
    if proc is not None and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
    shutil.rmtree(TMP_ROOT, ignore_errors=True)
