#!/usr/bin/env python3
"""Isolated headless Chromium browser verification for Issue #111 (Member Operations Enterprise Pack)."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
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

    def api(path, method='GET', body=None):
        req = urllib.request.Request(
            base + path,
            data=json.dumps(body).encode('utf-8') if body is not None else None,
            headers=headers,
            method=method,
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode('utf-8'))

    # Seed minimal synthetic configuration, enterprise, project, system, and pack panorama/purpose
    api('/api/configuration', 'PUT', {
        'name': 'Browser Synthetic',
        'provider': 'openai-compatible',
        'baseUrl': 'http://127.0.0.1:1/v1',
        'model': 'synthetic-browser',
        'apiKey': 'synthetic-only',
    })
    ent = api('/api/studio/enterprises', 'POST', {'name': '织屿服饰'})
    eid = ent['id']
    proj = api('/api/projects', 'POST', {'name': '织屿会员建设'})['project']
    api('/api/studio/enterprise-associations', 'POST', {'kind': 'project', 'entityId': proj['id'], 'enterpriseId': eid})
    import uuid as _uuid
    sys_obj = api('/api/studio/systems', 'POST', {
        'requestId': str(_uuid.uuid4()),
        'enterpriseId': eid,
        'name': '织屿会员运营体系',
        'projectId': proj['id'],
        'goal': '盘点会员运营现状并建设门店复购',
        'topicTitle': '会员运营',
    })['system']

    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1440, 'height': 900})
        page.on('pageerror', lambda err: errors.append(str(err)))
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

        # Seed a panorama + purpose via Host API (simulating Agent/Studio draft preparation), then verify UI preview -> confirm -> receipts
        packs = api(f'/api/studio/enterprise-packs?enterpriseId={eid}&domain=member-operations')['packs']
        pack_id = packs[0]['id']
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
                'selectedKey': 'first-store',
                'decidedBy': '会员运营负责人',
            }],
            'dependencies': [{
                'id': 'dep-sap-rep',
                'role': 'sap-metric',
                'authority': 'sap-metric',
                'ref': {
                    'authority': 'sap-metric',
                    'id': 'MET-REP-90D',
                    'version': '1.0.0',
                    'sha256': 'a' * 64,
                    'title': '90天门店复购率',
                },
                'requiredFor': ['limited-calculation'],
            }],
        })

        # Reload page and re-enter Studio via Settings -> 领域资产包 to verify cross-reload persistence
        page.reload(wait_until='networkidle')
        page.get_by_role('button', name='设置').first.click()
        page.get_by_role('button', name='领域资产包').click()
        page.get_by_text('原文可回查').first.wait_for(timeout=10_000)
        page.get_by_role('button', name='进入企业 Studio 建设').click()
        page.get_by_role('button', name='体系工作台').click()
        page.get_by_label('当前企业').select_option(eid)
        page.get_by_role('heading', name='企业会员运营资产包').wait_for(timeout=10_000)

        page.get_by_role('button', name='建设草案 (0 条 / 1 用途)').click()
        page.get_by_text('直营门店90天复购率（两店试算版）').first.wait_for(timeout=10_000)
        page.get_by_role('button', name='生成一份发布预览').click()
        page.get_by_role('heading', name='确认发布预览 · v1.0').wait_for(timeout=10_000)
        page.get_by_role('button', name='确认并按用途发布').click()
        page.get_by_text('当前发布版 v1.0').wait_for(timeout=10_000)
        page.get_by_text('P-1.0-1-1').wait_for(timeout=10_000)

        # Create and revoke a resource grant from UI
        page.get_by_role('button', name='三层资源授权 (0)').click()
        page.get_by_role('heading', name='新增项目资源授权').wait_for(timeout=10_000)
        page.get_by_label('被授权项目').select_option(proj['id'])
        page.get_by_label('最高操作层次').select_option('read-detail-recalculate')
        page.get_by_label('允许读取的门店（顿号或逗号分隔）').fill('星桥直营店')
        page.get_by_role('button', name='保存资源授权').click()
        page.get_by_text('门店：星桥直营店').wait_for(timeout=10_000)
        page.get_by_role('button', name='撤回授权').first.click()
        page.get_by_text('已撤回').first.wait_for(timeout=10_000)

        browser.close()

    if errors:
        raise RuntimeError(f'Browser page errors observed: {errors}')
    print('BROWSER_MEMBER_PACK_E2E: PASS (Settings T03 SHA-256 + Dedupe + Drawer -> Studio Member Pack Draft -> Preview -> Confirm Receipts -> Grants Create/Revoke, 0 page errors)')
finally:
    if proc is not None and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
    shutil.rmtree(TMP_ROOT, ignore_errors=True)
