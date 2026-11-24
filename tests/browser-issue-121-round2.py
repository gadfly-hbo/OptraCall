#!/usr/bin/env python3
"""Real headless Chromium Playwright verification for Issue #121 Round-2 (Items 01-06)."""
import csv
from datetime import date
import http.server
import io
import json
import os
import shutil
import socketserver
import subprocess
import tempfile
import threading
import time
import urllib.request
import uuid as _uuid
from playwright.sync_api import sync_playwright

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
TMP_ROOT = tempfile.mkdtemp(prefix='optracall-issue121-r2-browser-')
DATA_ROOT = os.path.join(TMP_ROOT, 'data')
PROJECTS_ROOT = os.path.join(TMP_ROOT, 'projects')
UI_ROOT = os.path.join(REPO_ROOT, 'dist')
CHROME_BIN = '/usr/bin/google-chrome'

# Shared state for our local synthetic OpenAI-compatible SSE server
llm_state = {
    'requests': [],
    'tool_results_seen': [],
}


def extract_csv_rows(tool_text: str):
    lines = [ln.strip() for ln in tool_text.splitlines() if ln.strip()]
    header_idx = next((i for i, ln in enumerate(lines) if ',' in ln and not ln.startswith('[')), -1)
    if header_idx < 0:
        return []
    csv_lines = [ln for ln in lines[header_idx:] if ',' in ln]
    reader = csv.DictReader(io.StringIO('\n'.join(csv_lines)))
    return [dict(row) for row in reader]


def compute_repurchase_from_tool_results(tool_results):
    members_rows = []
    orders_rows = []
    refunds_rows = []
    for text in tool_results:
        rows = extract_csv_rows(text)
        if not rows:
            continue
        cols = set(rows[0].keys())
        if 'cohort_month' in cols:
            members_rows.extend(rows)
        elif 'order_id' in cols and 'amount' in cols:
            orders_rows.extend(rows)
        elif 'refund_id' in cols:
            refunds_rows.extend(rows)

    cohort_members = [r for r in members_rows if r.get('cohort_month') == '2026-06']
    full_refund_ids = {r.get('order_id') for r in refunds_rows if str(r.get('full_refund', '')).lower() == 'true'}
    valid_orders_by_member = {}
    for o in orders_rows:
        oid = o.get('order_id')
        if oid in full_refund_ids:
            continue
        odate = o.get('order_date', '')
        if not ('2026-06-01' <= odate <= '2026-07-31'):
            continue
        valid_orders_by_member.setdefault(o.get('member_id'), []).append(o)

    by_store = {}
    total_den = 0
    total_num = 0
    for m in cohort_members:
        store = m.get('store', '')
        by_store.setdefault(store, {'den': 0, 'num': 0})
        by_store[store]['den'] += 1
        total_den += 1
        first_dt = date.fromisoformat(m['order_date'])
        m_orders = sorted(valid_orders_by_member.get(m.get('member_id'), []), key=lambda r: r['order_date'])
        repeated = any(0 < (date.fromisoformat(o['order_date']) - first_dt).days <= 30 for o in m_orders)
        if repeated:
            by_store[store]['num'] += 1
            total_num += 1
    return {
        'member_count': len(cohort_members),
        'order_count': len(orders_rows),
        'refund_count': len(refunds_rows),
        'by_store': by_store,
        'total_num': total_num,
        'total_den': total_den,
    }


class SyntheticLLMHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def do_POST(self):
        length = int(self.headers.get('Content-Length') or '0')
        raw = self.rfile.read(length).decode('utf-8')
        body = json.loads(raw)
        messages = body.get('messages') or []
        llm_state['requests'].append(body)

        user_texts = []
        tool_results = []
        for m in messages:
            role = m.get('role')
            content = m.get('content')
            if isinstance(content, list):
                text = '\n'.join(p.get('text', '') for p in content if isinstance(p, dict) and p.get('type') == 'text')
            else:
                text = str(content or '')
            if role == 'user':
                user_texts.append(text)
            elif role == 'tool':
                tool_results.append(text)
                llm_state['tool_results_seen'].append(text)

        last_user = user_texts[-1] if user_texts else ''
        wants_recalc = '逐笔重算' in last_user and len(tool_results) == 0

        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()

        def emit(chunk_obj):
            self.wfile.write(f'data: {json.dumps(chunk_obj, ensure_ascii=False)}\n\n'.encode('utf-8'))
            self.wfile.flush()

        cid = f'chatcmpl-{_uuid.uuid4().hex[:12]}'
        model = body.get('model') or 'synthetic-browser'

        if wants_recalc:
            calls = [
                ('call_1', 'read_input', {'filename': 'members.csv'}),
                ('call_2', 'read_input', {'filename': 'orders.csv'}),
                ('call_3', 'read_input', {'filename': 'refunds.csv'}),
                ('call_4', 'read_input', {'filename': 'unlisted_extra.csv'}),
            ]
            for idx, (call_id, name, args) in enumerate(calls):
                emit({
                    'id': cid,
                    'object': 'chat.completion.chunk',
                    'created': int(time.time()),
                    'model': model,
                    'choices': [{
                        'index': 0,
                        'delta': {
                            'role': 'assistant' if idx == 0 else None,
                            'tool_calls': [{
                                'index': idx,
                                'id': call_id,
                                'type': 'function',
                                'function': {'name': name, 'arguments': json.dumps(args, ensure_ascii=False)},
                            }],
                        },
                        'finish_reason': None,
                    }],
                })
            emit({
                'id': cid,
                'object': 'chat.completion.chunk',
                'created': int(time.time()),
                'model': model,
                'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'tool_calls'}],
            })
        else:
            if tool_results:
                combined = '\n'.join(tool_results)
                calc = compute_repurchase_from_tool_results(tool_results)
                a = calc['by_store'].get('甲店', {'num': 0, 'den': 0})
                b = calc['by_store'].get('乙店', {'num': 0, 'den': 0})
                has_c = '丙店' in combined
                has_aug = '2026-08-10' in combined
                reply_text = (
                    f"实读行逐笔重算：甲店分母{a['den']}、分子{a['num']}；乙店分母{b['den']}、分子{b['num']}；"
                    f"合计分母{calc['total_den']}、分子{calc['total_num']}（实读行数: members={calc['member_count']}, "
                    f"orders={calc['order_count']}, refunds={calc['refund_count']}, 丙店泄漏={has_c}, 8月超期泄漏={has_aug}）。"
                )
            else:
                reply_text = f'已收到问题并完成分析回复：{last_user[:80]}'
            emit({
                'id': cid,
                'object': 'chat.completion.chunk',
                'created': int(time.time()),
                'model': model,
                'choices': [{'index': 0, 'delta': {'role': 'assistant', 'content': reply_text}, 'finish_reason': None}],
            })
            emit({
                'id': cid,
                'object': 'chat.completion.chunk',
                'created': int(time.time()),
                'model': model,
                'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}],
            })
        self.wfile.write(b'data: [DONE]\n\n')
        self.wfile.flush()


class ReusableTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


llm_server = ReusableTCPServer(('127.0.0.1', 0), SyntheticLLMHandler)
llm_port = llm_server.server_address[1]
llm_thread = threading.Thread(target=llm_server.serve_forever, daemon=True)
llm_thread.start()

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

    # Configure local synthetic OpenAI-compatible provider
    api('/api/configuration', 'PUT', {
        'name': 'Browser Synthetic LLM',
        'provider': 'openai-compatible',
        'baseUrl': f'http://127.0.0.1:{llm_port}/v1',
        'model': 'synthetic-browser',
        'apiKey': 'synthetic-only',
    })

    # Seed Enterprise A (for Items 01, 02, 03, 04, 06) + Enterprise B (empty enterprise for Item 05 pure-UI flow!)
    api('/api/studio/operators/session', 'POST', {
        'action': 'register',
        'operatorId': 'seed-maintainer',
        'displayName': '种子维护人',
        'passcode': 'seed-pass-2026',
    })
    ent_a = api('/api/studio/enterprises', 'POST', {'name': '测试企业A'})
    eid_a = ent_a['id']
    proj_default = api('/api/projects', 'POST', {'name': '默认建设归属项目'})['project']
    proj_alt = api('/api/projects', 'POST', {'name': '备选体系建设项目'})['project']
    proj_t05_a = api('/api/projects', 'POST', {'name': '受限会员分析项目'})['project']
    for p in (proj_default, proj_alt, proj_t05_a):
        api('/api/studio/enterprise-associations', 'POST', {'kind': 'project', 'entityId': p['id'], 'enterpriseId': eid_a})

    # Create a Studio system + member pack in Enterprise A with U-01 and erroneous draft U-02 + an asset for candidate edit guard
    api(f"/api/projects/{proj_default['id']}", 'GET')
    sys_a = api('/api/studio/systems', 'POST', {
        'requestId': str(_uuid.uuid4()),
        'enterpriseId': eid_a,
        'name': '企业A基础资产体系',
        'projectId': proj_default['id'],
        'goal': '建设企业A会员复购指标与口径',
        'topicTitle': '会员复购建设',
    })['system']
    api(f"/api/studio/systems/{sys_a['id']}/assets", 'POST', {
        'requestId': str(_uuid.uuid4()),
        'kind': 'concept',
        'title': '有效购买口径资产',
        'body': '有效购买不含全额退款订单。',
        'scope': '企业A全渠道',
        'sources': [],
        'dependencies': [],
        'limitations': [],
        'reason': '初版候选',
        'readyForPublication': False,
        'checks': [],
    })
    pack_a = api('/api/studio/enterprise-packs', 'POST', {
        'requestId': str(_uuid.uuid4()),
        'enterpriseId': eid_a,
        'systemId': sys_a['id'],
        'projectId': proj_default['id'],
        'domain': 'member-operations',
        'name': '企业A · 会员运营资产包',
    })['pack']
    u01 = api(f"/api/studio/enterprise-packs/{pack_a['id']}/purposes", 'POST', {
        'requestId': str(_uuid.uuid4()),
        'projectId': proj_default['id'],
        'purposeKey': 'store_30d_repurchase',
        'title': '门店 30 日复购率（有效草案 U-01）',
        'businessQuestion': '甲乙两店 6 月会员 30 天复购率表现如何？',
        'subjectUnit': 'brand_account',
        'windowDays': 30,
        'scope': {'brand': '企业A', 'channel': '直营门店', 'period': '2026-06~2026-07', 'stores': ['甲店', '乙店'], 'scopeKey': 'entA:stores:30d'},
        'tier': 'definition-reference',
        'businessStatus': 'active',
        'originalGoal': '定义并核对 30 日复购率',
        'remainingGaps': [],
        'exclusions': ['全额退款'],
        'completionCriteria': '完成定义并发布',
        'policyEffectiveFrom': '2026-06-01',
        'dataCutoffAt': '2026-07-31',
    })['purpose']
    u02 = api(f"/api/studio/enterprise-packs/{pack_a['id']}/purposes", 'POST', {
        'requestId': str(_uuid.uuid4()),
        'projectId': proj_default['id'],
        'purposeKey': 'erroneous_test_draft',
        'title': '误建用途草案 U-02（不应入预览）',
        'businessQuestion': '误建测试问题',
        'subjectUnit': 'brand_account',
        'scope': {'brand': '企业A', 'channel': '未知', 'period': '2026-06', 'scopeKey': 'entA:erroneous:u02'},
        'tier': 'definition-reference',
        'businessStatus': 'unknown',
        'originalGoal': '误建',
        'remainingGaps': ['误建草案'],
        'exclusions': [],
        'completionCriteria': '不应发布',
    })['purpose']

    # Seed Enterprise B (EMPTY: zero systems, zero packs!) + owner project + consumer T05 project with 3 synthetic CSVs for Item 05 pure-UI flow
    ent_b = api('/api/studio/enterprises', 'POST', {'name': '雅澜纯界面企业'})
    eid_b = ent_b['id']
    proj_b_owner = api('/api/projects', 'POST', {'name': '雅澜建设权责项目'})['project']
    proj_b_t05 = api('/api/projects', 'POST', {'name': 'T05 门店复购分析项目'})['project']
    for p in (proj_b_owner, proj_b_t05):
        api('/api/studio/enterprise-associations', 'POST', {'kind': 'project', 'entityId': p['id'], 'enterpriseId': eid_b})
    # Write 3 synthetic CSVs + 1 unlisted CSV into proj_b_t05 020_clean/
    t05_clean = os.path.join(proj_b_t05['rootPath'], '020_clean')
    os.makedirs(t05_clean, exist_ok=True)
    with open(os.path.join(t05_clean, 'members.csv'), 'w', encoding='utf-8') as f:
        f.write('member_id,store,order_date,cohort_month\nM001,甲店,2026-06-05,2026-06\nM002,甲店,2026-06-10,2026-06\nM003,乙店,2026-06-12,2026-06\nM004,丙店,2026-06-15,2026-06\n')
    with open(os.path.join(t05_clean, 'orders.csv'), 'w', encoding='utf-8') as f:
        f.write('order_id,member_id,store,order_date,amount\nO01,M001,甲店,2026-06-05,300\nO02,M001,甲店,2026-06-25,280\nO03,M002,甲店,2026-06-10,200\nO04,M002,甲店,2026-07-02,220\nO05,M003,乙店,2026-06-12,400\nO06,M003,乙店,2026-07-05,350\nO07,M004,丙店,2026-06-15,500\nO08,M001,甲店,2026-08-10,199\n')
    with open(os.path.join(t05_clean, 'refunds.csv'), 'w', encoding='utf-8') as f:
        f.write('refund_id,order_id,store,order_date,full_refund\nR01,O04,甲店,2026-07-04,true\nR02,O07,丙店,2026-06-18,true\n')
    with open(os.path.join(t05_clean, 'unlisted_extra.csv'), 'w', encoding='utf-8') as f:
        f.write('member_id,store,order_date\nM999,甲店,2026-06-15\n')

    with sync_playwright() as p:
        launch_kwargs = {'headless': True}
        if os.path.exists(CHROME_BIN):
            launch_kwargs['executable_path'] = CHROME_BIN
        browser = p.chromium.launch(**launch_kwargs)

        # =====================================================================
        # ITEM 01 (P1): Default Skill checked in restricted member-pack project
        # =====================================================================
        ctx1 = browser.new_context(viewport={'width': 1440, 'height': 900})
        page1 = ctx1.new_page()
        page1.goto(f"{base}/?project={proj_t05_a['id']}", wait_until='domcontentloaded')
        page1.get_by_role('button', name='新建第一个任务').click()
        dlg = page1.locator('dialog[open]')
        dlg.wait_for(state='visible')
        skill_cb = dlg.locator('label', has_text='默认 Skill').locator('input[type="checkbox"]')
        assert skill_cb.count() == 1 and skill_cb.is_checked(), 'Item 01: default data-analysis Skill must be checked by default'
        dlg.locator('#task-name').fill('受限项目默认Skill分析')
        msg_statuses = []
        page1.on('response', lambda r: msg_statuses.append(r.status) if '/messages' in r.url and r.request.method == 'POST' else None)
        dlg.get_by_role('button', name='创建任务').click()
        page1.locator('#message-input').wait_for(state='visible')
        page1.locator('#message-input').fill('截至 7 月 31 日，甲乙两店 6 月会员的 30 天复购表现有什么差异？')
        page1.get_by_role('button', name='发送消息').click()
        page1.locator('.message.assistant').first.wait_for(state='visible', timeout=15000)
        assert 202 in msg_statuses, f'Item 01: expected HTTP 202 on POST /messages, got {msg_statuses}'
        assert page1.locator('.error-notice').count() == 0, 'Item 01: unexpected error notice after sending with default Skill'
        print('PASS [Browser Item 01] Restricted member-pack task with default data-analysis Skill succeeded (202 + reply)')

        # =====================================================================
        # ITEM 03 (P2): Pre-acceptance 409 preserves multiline prompt & state
        # =====================================================================
        # Create two fresh tasks in proj_alt (Task-A and Task-B)
        task_a = api(f"/api/projects/{proj_alt['id']}/tasks", 'POST', {'name': 'Item03-TaskA'})['task']
        task_b = api(f"/api/projects/{proj_alt['id']}/tasks", 'POST', {'name': 'Item03-TaskB'})['task']
        page1.goto(f"{base}/?project={proj_alt['id']}&task={task_a['id']}", wait_until='domcontentloaded')
        page1.locator('#message-input').wait_for(state='visible')
        multiline_prompt = '第一行：甲乙两店复购对比\n第二行：含特殊字符 & "引号"\n第三行：请保留完整原文'
        page1.locator('#message-input').fill(multiline_prompt)
        # Wait briefly for draft save to settle
        page1.wait_for_timeout(400)

        post_calls = {'count': 0, 'fail_once': True, 'last_body': None}

        def intercept_messages(route):
            if route.request.method == 'POST':
                post_calls['count'] += 1
                post_calls['last_body'] = route.request.post_data
                if post_calls['fail_once']:
                    post_calls['fail_once'] = False
                    route.fulfill(
                        status=409,
                        content_type='application/json',
                        body=json.dumps({'code': 'task_skill_unavailable', 'message': '模拟接受前 409 拒绝', 'accepted': False}, ensure_ascii=False),
                    )
                    return
            route.continue_()

        page1.route(f"**/api/projects/{proj_alt['id']}/tasks/{task_a['id']}/messages", intercept_messages)
        page1.get_by_role('button', name='发送消息').click()
        page1.locator('.error-notice').wait_for(state='visible', timeout=8000)
        err_text = page1.locator('.error-notice').inner_text()
        assert '发送未获 Host 接受' in err_text and '模拟接受前 409 拒绝' in err_text, f'Item 03: inaccurate error text: {err_text}'
        assert page1.locator('#message-input').input_value() == multiline_prompt, 'Item 03: multiline prompt lost immediately after 409!'
        assert page1.locator('.message.user').count() == 0, 'Item 03: rejected message must NOT render as sent user message!'
        assert page1.get_by_role('button', name='重试本次消息').is_visible(), 'Item 03: retry button missing'

        # Switch to Task-B: must NOT see Task-A's prompt or error
        page1.goto(f"{base}/?project={proj_alt['id']}&task={task_b['id']}", wait_until='domcontentloaded')
        page1.locator('#message-input').wait_for(state='visible')
        assert page1.locator('#message-input').input_value() == '', 'Item 03: Task-B leaked Task-A prompt!'
        assert page1.locator('.error-notice').count() == 0, 'Item 03: Task-B leaked Task-A error!'

        # Switch back to Task-A AND full page reload: must restore exact multiline prompt & error, zero auto-send
        before_reload_count = post_calls['count']
        page1.goto(f"{base}/?project={proj_alt['id']}&task={task_a['id']}", wait_until='domcontentloaded')
        page1.locator('#message-input').wait_for(state='visible')
        page1.reload(wait_until='domcontentloaded')
        page1.locator('#message-input').wait_for(state='visible')
        page1.wait_for_timeout(600)
        assert post_calls['count'] == before_reload_count, f'Item 03: auto-sent on reopen/reload! count={post_calls["count"]}'
        assert page1.locator('#message-input').input_value() == multiline_prompt, 'Item 03: multiline prompt lost after full reload!'
        assert page1.locator('.error-notice').is_visible(), 'Item 03: failure status lost after full reload!'
        assert page1.get_by_role('button', name='重试本次消息').is_visible(), 'Item 03: retry button lost after full reload!'

        # Edit prompt and explicitly click retry once -> exactly 1 POST /messages, succeeds!
        edited_prompt = multiline_prompt + '\n第四行：已微调后显式重试'
        page1.locator('#message-input').fill(edited_prompt)
        page1.wait_for_timeout(300)
        page1.get_by_role('button', name='重试本次消息').click()
        page1.locator('.message.assistant').first.wait_for(state='visible', timeout=15000)
        assert post_calls['count'] == before_reload_count + 1, f'Item 03: expected 1 explicit retry POST, got {post_calls["count"] - before_reload_count}'
        assert '已微调后显式重试' in (post_calls['last_body'] or ''), 'Item 03: retry did not send edited text!'
        assert page1.locator('#message-input').input_value() == '', 'Item 03: draft should clear after accepted send'
        page1.unroute(f"**/api/projects/{proj_alt['id']}/tasks/{task_a['id']}/messages")

        # Helper to read task state with browser's own cookies (avoids project-context 403)
        def ctx1_cookie():
            return '; '.join(f"{c['name']}={c['value']}" for c in ctx1.cookies())

        # Item 03 Scenario A (PM blocker): Delayed 202 -> Host accepts & finishes -> full page reload BEFORE 202 returns -> composer MUST be empty & strictly 1 native user message!
        task_c = api(f"/api/projects/{proj_alt['id']}/tasks", 'POST', {'name': 'Item03-Delayed202-Reload'})['task']
        page1.goto(f"{base}/?project={proj_alt['id']}&task={task_c['id']}", wait_until='domcontentloaded')
        page1.locator('#message-input').wait_for(state='visible')
        prompt_c = '延迟202场景A：已受理消息刷新后不可重复发送'
        page1.locator('#message-input').fill(prompt_c)
        page1.wait_for_timeout(350)
        page1.evaluate("""() => {
          const orig = window.fetch.bind(window);
          let armed = true;
          window.fetch = async (...args) => {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
            const method = (args[1] && args[1].method) || (args[0] && args[0].method) || 'GET';
            const resp = await orig(...args);
            if (armed && method.toUpperCase() === 'POST' && url.includes('/messages')) {
              armed = false;
              await new Promise(resolve => { window.__release202A = resolve; });
            }
            return resp;
          };
        }""")
        page1.get_by_role('button', name='发送消息').click()
        # Wait for Host run to complete via SSE while 202 is STILL held!
        page1.locator('.message.assistant').first.wait_for(state='visible', timeout=15000)
        # Reload page BEFORE delayed 202 is ever delivered to App.tsx!
        page1.reload(wait_until='domcontentloaded')
        page1.locator('#message-input').wait_for(state='visible')
        page1.wait_for_timeout(400)
        assert page1.locator('#message-input').input_value() == '', f'Item 03 Scenario A: accepted prompt reappeared in composer after reload! val={page1.locator("#message-input").input_value()!r}'
        assert page1.get_by_role('button', name='发送消息').is_disabled(), 'Item 03 Scenario A: send button must be disabled when composer is empty after reload'
        task_c_state = api(f"/api/projects/{proj_alt['id']}/tasks/{task_c['id']}", 'GET', cookie=ctx1_cookie())
        user_msgs_c = [m for m in task_c_state['snapshot']['messages'] if m.get('role') == 'user']
        assert len(user_msgs_c) == 1, f'Item 03 Scenario A: expected strictly 1 native user message, got {len(user_msgs_c)}'
        assert task_c_state['task']['draft'] == '', f'Item 03 Scenario A: Host draft must be empty, got {task_c_state["task"]["draft"]!r}'

        # Item 03 Scenario B (PM blocker): Delayed 202 -> SSE settles -> user types & saves newer draft -> delayed 202 finally arrives -> BOTH UI & Host MUST keep newer draft!
        task_d = api(f"/api/projects/{proj_alt['id']}/tasks", 'POST', {'name': 'Item03-Delayed202-NewDraft'})['task']
        page1.goto(f"{base}/?project={proj_alt['id']}&task={task_d['id']}", wait_until='domcontentloaded')
        page1.locator('#message-input').wait_for(state='visible')
        prompt_d1 = '延迟202场景B：第一条已受理消息'
        newer_draft = '延迟202场景B：用户后来已保存的新草稿-2'
        page1.locator('#message-input').fill(prompt_d1)
        page1.wait_for_timeout(350)
        page1.evaluate("""() => {
          const orig = window.fetch.bind(window);
          let armed = true;
          window.__held202B = false;
          window.fetch = async (...args) => {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
            const method = (args[1] && args[1].method) || (args[0] && args[0].method) || 'GET';
            const resp = await orig(...args);
            if (armed && method.toUpperCase() === 'POST' && url.includes('/messages')) {
              armed = false;
              window.__held202B = true;
              await new Promise(resolve => { window.__release202B = resolve; });
            }
            return resp;
          };
        }""")
        page1.get_by_role('button', name='发送消息').click()
        # Wait for SSE assistant reply & composer unlock WHILE 202 is STILL held!
        page1.locator('.message.assistant').first.wait_for(state='visible', timeout=15000)
        page1.wait_for_function('() => window.__held202B === true && !document.querySelector("#message-input")?.disabled', timeout=10000)
        # User types and saves newer draft to Host BEFORE delayed 202 arrives!
        page1.locator('#message-input').fill(newer_draft)
        page1.wait_for_timeout(500)
        task_d_before_202 = api(f"/api/projects/{proj_alt['id']}/tasks/{task_d['id']}", 'GET', cookie=ctx1_cookie())
        assert task_d_before_202['task']['draft'] == newer_draft, f'Item 03 Scenario B: newer draft was not saved to Host before delayed 202! got={task_d_before_202["task"]["draft"]!r}'
        # NOW deliver the stale delayed 202 response!
        page1.evaluate('() => window.__release202B && window.__release202B()')
        page1.wait_for_timeout(600)
        assert page1.locator('#message-input').input_value() == newer_draft, f'Item 03 Scenario B: delayed 202 wiped newer UI draft! got={page1.locator("#message-input").input_value()!r}'
        task_d_mid = api(f"/api/projects/{proj_alt['id']}/tasks/{task_d['id']}", 'GET', cookie=ctx1_cookie())
        assert task_d_mid['task']['draft'] == newer_draft, f'Item 03 Scenario B: delayed 202 wiped newer Host draft! got={task_d_mid["task"]["draft"]!r}'
        # Now send the preserved newer draft as turn 2, and deliberately type the same text again for legal turn 3!
        page1.get_by_role('button', name='发送消息').click()
        page1.wait_for_function('() => document.querySelectorAll(".message.assistant").length >= 2', timeout=15000)
        page1.locator('#message-input').fill(newer_draft)
        page1.wait_for_timeout(350)
        page1.get_by_role('button', name='发送消息').click()
        page1.wait_for_function('() => document.querySelectorAll(".message.assistant").length >= 3', timeout=15000)
        task_d_end = api(f"/api/projects/{proj_alt['id']}/tasks/{task_d['id']}", 'GET', cookie=ctx1_cookie())
        assert len([m for m in task_d_end['snapshot']['messages'] if m.get('role') == 'user']) == 3, 'Item 03: expected 3 distinct turns after deliberate re-send'
        print('PASS [Browser Item 03] Pre-acceptance 409 preservation + delayed-202 reload no-duplicate + delayed-202 newer-draft preservation + deliberate resend verified')

        # =====================================================================
        # ITEM 02 (P2): Studio construction form required hints & project guard
        # =====================================================================
        page1.goto(f"{base}/?project={proj_default['id']}", wait_until='domcontentloaded')
        page1.get_by_role('button', name='分析资产').click()
        page1.get_by_role('button', name='体系工作台').click()
        page1.get_by_role('button', name='建设与演进').click()
        # Ensure Enterprise A is selected
        ent_select = page1.locator('select[aria-label="企业范围"]').first
        if ent_select.count() > 0:
            ent_select.select_option(eid_a)
            page1.wait_for_timeout(400)

        system_post_bodies = []
        page1.on('request', lambda r: system_post_bodies.append(r.post_data) if r.url.endswith('/api/studio/systems') and r.method == 'POST' else None)

        page1.get_by_role('button', name='＋ 发起体系建设').click()
        page1.locator('#studio-create-form').wait_for(state='visible')

        # 2a: Empty goal -> persistent inline error, zero API call, focus moves to goal
        page1.get_by_role('button', name='发起建设', exact=True).click()
        goal_err = page1.locator('#studio-new-goal-error')
        goal_err.wait_for(state='visible')
        assert '请填写建设目标与企业范围' in goal_err.inner_text() and '下一步' in goal_err.inner_text()
        assert len(system_post_bodies) == 0, 'Item 02: empty goal must not send POST /api/studio/systems'
        focused_id = page1.evaluate('document.activeElement?.id')
        assert focused_id == 'studio-new-goal', f'Item 02: focus expected on studio-new-goal, got {focused_id}'

        # 2b: Whitespace-only goal -> persistent inline error, zero API call, other inputs preserved
        page1.locator('#studio-new-project').select_option(proj_alt['id'])
        page1.locator('#studio-new-goal').fill('   \n   ')
        page1.get_by_role('button', name='发起建设', exact=True).click()
        goal_err.wait_for(state='visible')
        assert len(system_post_bodies) == 0, 'Item 02: whitespace goal must not send POST /api/studio/systems'
        assert page1.locator('#studio-new-project').input_value() == proj_alt['id'], 'Item 02: selected project lost on validation failure'

        # 2c: Project-only change + close -> leave-guard prompt appears, continue editing keeps 2nd project!
        page1.locator('#studio-new-goal').fill('')
        page1.get_by_role('button', name='返回原位置').click()
        leave_heading = page1.get_by_text('保留未发起的体系建设？')
        leave_heading.wait_for(state='visible')
        page1.get_by_role('button', name='继续编辑').click()
        assert page1.locator('#studio-new-project').input_value() == proj_alt['id'], 'Item 02: continuing edit lost chosen 2nd project!'

        # 2d: Close + discard -> closes cleanly with 0 API calls
        page1.get_by_role('button', name='返回原位置').click()
        leave_heading.wait_for(state='visible')
        page1.get_by_role('button', name='放弃本次未保存修改').click()
        page1.locator('#studio-create-form').wait_for(state='hidden')
        assert len(system_post_bodies) == 0, 'Item 02: discard must not create system'

        # 2e: Reopen, select 2nd project, fill goal, submit once -> 1 system created in 2nd project!
        page1.get_by_role('button', name='＋ 发起体系建设').click()
        page1.locator('#studio-create-form').wait_for(state='visible')
        page1.locator('#studio-new-project').select_option(proj_alt['id'])
        page1.locator('#studio-new-goal').fill('在备选项目发起一次有效体系建设')
        page1.get_by_role('button', name='发起建设', exact=True).click()
        page1.locator('#studio-create-form').wait_for(state='hidden', timeout=10000)
        assert len(system_post_bodies) == 1, f'Item 02: expected 1 POST /api/studio/systems, got {len(system_post_bodies)}'
        posted = json.loads(system_post_bodies[0])
        assert posted['projectId'] == proj_alt['id'], f'Item 02: wrong projectId {posted["projectId"]}'

        # 2f: Separate verification of candidate editing leave-guard!
        page1.goto(f"{base}/?project={proj_default['id']}&studio={sys_a['id']}", wait_until='domcontentloaded')
        page1.get_by_role('button', name='资产', exact=True).click()
        page1.get_by_role('button', name='有效购买口径资产').click()
        page1.get_by_role('button', name='编辑候选').click()
        page1.locator('#studio-asset-title').fill('有效购买口径资产（未保存修改）')
        page1.get_by_role('button', name='返回原位置').click()
        page1.get_by_text('保留未保存的候选编辑？').wait_for(state='visible')
        page1.get_by_role('button', name='继续编辑').click()
        assert page1.locator('#studio-asset-title').input_value() == '有效购买口径资产（未保存修改）'
        page1.get_by_role('button', name='返回原位置').click()
        page1.get_by_role('button', name='放弃本次未保存修改').click()
        print('PASS [Browser Item 02] Persistent inline required hints, project-only leave-guard, single submit, and separate candidate-edit leave-guard verified')

        # =====================================================================
        # ITEM 04 (P2): Purpose revision + explicit exclusion of U-02 before preview
        # =====================================================================
        # Authenticate as seed-maintainer on proj_default so we have write authority on Enterprise A pack
        page1.goto(f"{base}/?project={proj_default['id']}", wait_until='domcontentloaded')
        page1.get_by_role('button', name='分析资产').click()
        page1.get_by_role('button', name='体系工作台').click()
        page1.get_by_label('当前企业').select_option(eid_a)
        page1.get_by_role('navigation', name='体系工作台视图').get_by_role('button', name='覆盖与缺口').click()
        page1.get_by_role('heading', name='企业会员运营资产包').wait_for(state='visible', timeout=10000)
        # Login as seed-maintainer via UI top maintainer bar (or grants bar)
        if page1.get_by_label('维护人操作者标识').is_visible():
            page1.get_by_label('维护人操作者标识').fill('seed-maintainer')
            page1.get_by_label('维护人口令').fill('seed-pass-2026')
            page1.get_by_role('button', name='建立/登录具名维护身份').click()
            page1.wait_for_timeout(600)

        page1.get_by_role('button', name='建设草案').click()
        u01_row = page1.locator(f'tr[data-purpose-id="{u01["id"]}"]')
        u02_row = page1.locator(f'tr[data-purpose-id="{u02["id"]}"]')
        u01_row.wait_for(state='visible')
        u02_row.wait_for(state='visible')

        # 4a (PM blocker): Temporarily uncheck U-02 (WITHOUT clicking permanent exclusion), THEN edit & save U-01!
        # U-02 MUST stay unchecked after U-01 saves, and preview/v1.0 MUST contain ONLY U-01!
        u02_row.locator('input[type="checkbox"]').uncheck()
        assert not u02_row.locator('input[type="checkbox"]').is_checked(), 'Item 04a: U-02 should be temporarily unchecked'
        assert '已选 1/2 项' in page1.get_by_role('button', name='生成一份发布预览').inner_text()

        u01_row.get_by_role('button', name='修正草案').click()
        page1.locator('#studio-purpose-edit-form').wait_for(state='visible')
        page1.locator('#studio-purpose-edit-form textarea').last.fill('本次已核对会员复购定义依据备注')
        page1.get_by_role('button', name='保存草案修正').click()
        page1.locator('#studio-purpose-edit-form').wait_for(state='hidden', timeout=8000)
        assert '本次已核对会员复购定义依据备注' in u01_row.inner_text(), 'Item 04a: evidenceNote not read back in UI!'
        assert not u02_row.locator('input[type="checkbox"]').is_checked(), 'Item 04a: editing U-01 re-checked temporarily unchecked U-02!'
        assert '已选 1/2 项' in page1.get_by_role('button', name='生成一份发布预览').inner_text(), 'Item 04a: preview count reset after editing U-01!'

        # Capture POST /previews request body & confirm v1.0 contains ONLY U-01!
        preview_post_bodies = []
        page1.on('request', lambda r: preview_post_bodies.append(r.post_data) if r.url.endswith('/previews') and r.method == 'POST' else None)
        page1.get_by_role('button', name='生成一份发布预览').click()
        preview_dialog = page1.locator('dialog[open]')
        preview_dialog.wait_for(state='visible', timeout=8000)
        assert len(preview_post_bodies) >= 1, 'Item 04a: expected POST /previews request'
        assert json.loads(preview_post_bodies[-1]).get('purposeIds') == [u01['id']], f'Item 04a: preview purposeIds leaked U-02! body={preview_post_bodies[-1]}'
        preview_text = preview_dialog.inner_text()
        assert '门店 30 日复购率' in preview_text and '误建用途草案 U-02' not in preview_text, f'Item 04a: U-02 leaked into preview! {preview_text}'
        preview_dialog.get_by_role('button', name='确认并按用途发布').click()
        preview_dialog.wait_for(state='hidden', timeout=10000)
        pub_text = page1.locator('.studio-member-pack-section').inner_text()
        assert '当前发布版 v1.0' in pub_text and '门店 30 日复购率' in pub_text and '误建用途草案 U-02' not in pub_text

        # 4b: Permanently exclude erroneous U-02 from default preview & verify persistence across full reload!
        page1.get_by_role('button', name='建设草案').click()
        u02_row = page1.locator(f'tr[data-purpose-id="{u02["id"]}"]')
        u02_row.get_by_role('button', name='排除出默认预览').click()
        u02_row.get_by_text('已排除出默认预览').wait_for(state='visible', timeout=8000)
        assert not u02_row.locator('input[type="checkbox"]').is_checked(), 'Item 04b: U-02 checkbox should be unchecked after permanent exclusion'
        assert '已选 1/2 项' in page1.get_by_role('button', name='生成一份发布预览').inner_text()

        # Full page reload -> U-02 MUST stay excluded!
        page1.reload(wait_until='domcontentloaded')
        page1.get_by_role('button', name='分析资产').click()
        page1.get_by_role('button', name='体系工作台').click()
        page1.get_by_label('当前企业').select_option(eid_a)
        page1.get_by_role('navigation', name='体系工作台视图').get_by_role('button', name='覆盖与缺口').click()
        page1.get_by_role('heading', name='企业会员运营资产包').wait_for(state='visible', timeout=10000)
        page1.get_by_role('button', name='建设草案').click()
        u02_row = page1.locator(f'tr[data-purpose-id="{u02["id"]}"]')
        u02_row.get_by_text('已排除出默认预览').wait_for(state='visible')
        assert not u02_row.locator('input[type="checkbox"]').is_checked(), 'Item 04b: U-02 exclusion did not persist across reload!'

        # Publish v1.1 and verify v1.0 history remains inspectable in 反馈、修订与历史
        assert page1.locator(f'tr[data-purpose-id="{u02["id"]}"]').is_visible(), 'Item 04b: excluded draft U-02 history should remain visible in draft table'
        page1.get_by_role('button', name='生成一份发布预览').click()
        page1.locator('dialog[open]').get_by_role('button', name='确认并按用途发布').click()
        page1.locator('dialog[open]').wait_for(state='hidden', timeout=10000)
        page1.get_by_role('button', name='反馈、修订与历史').click()
        v10_summary = page1.get_by_text('查看 v1.0 收录用途清单')
        v10_summary.wait_for(state='visible')
        v10_summary.click()
        assert '门店 30 日复购率' in page1.locator('.studio-member-pack-section').inner_text()
        print('PASS [Browser Item 04] Temporary U-02 uncheck preserved across U-01 edit + v1.0, permanent U-02 exclusion persisted across reload + v1.1, and v1.0 history inspection verified')

        # =====================================================================
        # ITEM 06 (P3): Empirical re-verification of new-task dialog vs background
        # =====================================================================
        page1.set_viewport_size({'width': 1440, 'height': 900})
        page1.goto(f"{base}/?project={proj_alt['id']}", wait_until='domcontentloaded')
        page1.locator(f'button[aria-label="在 {proj_alt["name"]} 中新建任务"]').click()
        orig_modal = page1.locator('dialog[open]')
        orig_modal.wait_for(state='visible')
        orig_modal.locator('#task-name').fill('已有背景任务-验证双框')
        assert orig_modal.locator('label', has_text='默认 Skill').locator('input[type="checkbox"]').is_checked()
        orig_modal.get_by_role('button', name='创建任务').click()
        orig_modal.wait_for(state='hidden', timeout=8000)
        page1.locator('#message-input').wait_for(state='visible')
        orig_url = page1.url
        for cycle_idx, vp in enumerate([
            {'width': 1440, 'height': 900},
            {'width': 1440, 'height': 900},
            {'width': 1440, 'height': 900},
            {'width': 390, 'height': 844},
            {'width': 390, 'height': 844},
        ], start=1):
            page1.set_viewport_size(vp)
            page1.goto(orig_url, wait_until='domcontentloaded')
            # Expand background 交接与依据 so background Skill checkbox is rendered in DOM
            handoff_details = page1.locator('details.harness-panel', has_text='交接与依据').first
            handoff_details.wait_for(state='visible')
            if handoff_details.get_attribute('open') is None:
                handoff_details.locator('summary').click()
            bg_skill_cb = handoff_details.locator('input[type="checkbox"]').first
            bg_skill_cb.wait_for(state='visible')
            assert bg_skill_cb.is_checked(), f'Item 06 cycle {cycle_idx}: background task skill should start checked'

            # Open 新建任务 dialog (expand sidebar first on narrow screen if collapsed)
            if page1.locator('button[aria-label="展开侧栏"]').is_visible():
                page1.locator('button[aria-label="展开侧栏"]').click()
            page1.locator(f'button[aria-label="在 {proj_alt["name"]} 中新建任务"]').click()
            modal = page1.locator('dialog[open]')
            modal.wait_for(state='visible')

            # Check modal has strictly ONE 默认 Skill checkbox and clearly names target project/new task
            modal_cbs = modal.locator('label', has_text='默认 Skill').locator('input[type="checkbox"]')
            assert modal_cbs.count() == 1, f'Item 06 cycle {cycle_idx}: expected 1 默认 Skill checkbox in dialog, got {modal_cbs.count()}'
            modal_text = modal.inner_text()
            assert '新建任务' in modal_text and proj_alt['name'] in modal_text, f'Item 06 cycle {cycle_idx}: dialog target unclear: {modal_text}'

            # Verify top-layer modal blocks pointer click on background Skill checkbox (hit-testing via elementFromPoint)
            bg_box = bg_skill_cb.bounding_box()
            if bg_box:
                hit_inside_dialog = page1.evaluate(
                    '([x, y]) => { const el = document.elementFromPoint(x, y); return !el || Boolean(el.closest("dialog[open]")) || el.tagName === "DIALOG"; }',
                    [bg_box['x'] + bg_box['width'] / 2, bg_box['y'] + bg_box['height'] / 2],
                )
                assert hit_inside_dialog, f'Item 06 cycle {cycle_idx}: background Skill checkbox was NOT shielded by modal dialog top-layer!'

            # Verify keyboard Tab stays inside dialog / Escape closes cleanly
            if cycle_idx in (2, 4):
                page1.keyboard.press('Tab')
                in_dlg = page1.evaluate('Boolean(document.activeElement?.closest("dialog[open]"))')
                assert in_dlg, f'Item 06 cycle {cycle_idx}: keyboard Tab escaped modal dialog!'
                page1.keyboard.press('Escape')
            else:
                modal.get_by_role('button', name='取消').click()
            modal.wait_for(state='hidden')
            assert bg_skill_cb.is_checked(), f'Item 06 cycle {cycle_idx}: background task Skill state unexpectedly changed!'

        # Final Item 06 check: create new task with Skill UNCHECKED -> verify new task stays OFF while original stays ON after reload
        page1.set_viewport_size({'width': 1440, 'height': 900})
        if page1.locator('button[aria-label="展开侧栏"]').is_visible():
            page1.locator('button[aria-label="展开侧栏"]').click()
        page1.locator(f'button[aria-label="在 {proj_alt["name"]} 中新建任务"]').click()
        modal = page1.locator('dialog[open]')
        modal.wait_for(state='visible')
        modal.locator('#task-name').fill('关闭Skill新建任务对照')
        modal.locator('label', has_text='默认 Skill').locator('input[type="checkbox"]').uncheck()
        modal.get_by_role('button', name='创建任务').click()
        modal.wait_for(state='hidden', timeout=8000)
        page1.reload(wait_until='domcontentloaded')
        new_handoff = page1.locator('details.harness-panel', has_text='交接与依据').first
        new_handoff.wait_for(state='visible')
        new_handoff.locator('summary').click()
        new_cb = new_handoff.locator('input[type="checkbox"]').first
        assert not new_cb.is_checked(), 'Item 06: newly created task with Skill unchecked did not persist OFF after reload!'
        # Switch back to original task -> still ON!
        page1.goto(orig_url, wait_until='domcontentloaded')
        orig_handoff = page1.locator('details.harness-panel', has_text='交接与依据').first
        orig_handoff.wait_for(state='visible')
        orig_handoff.locator('summary').click()
        assert orig_handoff.locator('input[type="checkbox"]').first.is_checked(), 'Item 06: original background task Skill was affected!'
        print('PASS [Browser Item 06] 5/5 open/cancel/reopen cycles (desktop + 390x844, mouse + keyboard) confirmed single modal Skill checkbox, top-layer shielding, and task independence')
        ctx1.close()

        # =====================================================================
        # ITEM 05 (P2): Pure-UI empty enterprise -> in-flight auth guard in 发起体系建设 ->
        #               named maintainer -> pack -> Browser 2 blocked guidance -> re-auth ->
        #               grant T05 -> independent T05 task reads 3 CSVs & dynamically recalculates 2/3!
        # =====================================================================
        # Browser 1 (fresh context, empty synthetic enterprise B)
        b1_ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
        b1 = b1_ctx.new_page()
        b1.goto(f"{base}/?project={proj_b_owner['id']}", wait_until='domcontentloaded')
        b1.get_by_role('button', name='分析资产').click()
        b1.get_by_role('button', name='体系工作台').click()
        b1.get_by_label('当前企业').select_option(eid_b)
        b1.get_by_role('navigation', name='体系工作台视图').get_by_role('button', name='建设与演进').click()

        # Pure UI inside 发起体系建设: test in-flight identity auth race (PM blocker)!
        b1.get_by_role('button', name='＋ 发起体系建设').click()
        b1.locator('#studio-create-form').wait_for(state='visible')
        b1.locator('#studio-new-project').select_option(proj_b_owner['id'])
        goal_b = '为雅澜纯界面企业建设会员运营 30 日复购资产体系'
        b1.locator('#studio-new-goal').fill(goal_b)

        id_region = b1.locator('[aria-label="体系建设维护人身份"]')
        id_region.wait_for(state='visible')
        assert '临时浏览器会话' in id_region.inner_text() or '未认证' in id_region.inner_text()

        # 5a: Failed auth (wrong passcode for existing operator seed-maintainer) -> inline error, form & project preserved, button re-enabled!
        id_region.get_by_label('建设维护人 ID').fill('seed-maintainer')
        id_region.get_by_label('建设维护人口令').fill('wrong-pass')
        id_region.get_by_role('button', name='建立/登录维护身份').click()
        id_region.locator('[role="alert"]').wait_for(state='visible', timeout=8000)
        assert b1.locator('#studio-new-goal').input_value() == goal_b, 'Item 05a: failed identity auth wiped goal!'
        assert b1.locator('#studio-new-project').input_value() == proj_b_owner['id'], 'Item 05a: failed identity auth wiped project!'
        assert not b1.get_by_role('button', name='发起建设', exact=True).is_disabled(), 'Item 05a: submit button should re-enable after auth failure'

        # 5b: Slow/in-flight auth for yalan-ui-ops -> while 验证中…, 发起建设 MUST be disabled (等待维护身份验证…), 0 premature system creates!
        b1_sys_posts = []
        b1.on('request', lambda r: b1_sys_posts.append(r.post_data) if r.url.endswith('/api/studio/systems') and r.method == 'POST' else None)
        b1.evaluate("""() => {
          const orig = window.fetch.bind(window);
          let armed = true;
          window.__heldOpAuth = false;
          window.fetch = async (...args) => {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
            const method = (args[1] && args[1].method) || (args[0] && args[0].method) || 'GET';
            const body = (args[1] && typeof args[1].body === 'string') ? args[1].body : '';
            if (armed && method.toUpperCase() === 'POST' && url.includes('/api/studio/operators/session') && body.includes('yalan-ui-ops')) {
              armed = false;
              const resp = await orig(...args);
              window.__heldOpAuth = true;
              await new Promise(resolve => { window.__releaseOpAuth = resolve; });
              return resp;
            }
            return orig(...args);
          };
        }""")
        id_region.get_by_label('建设维护人 ID').fill('yalan-ui-ops')
        id_region.get_by_label('建设维护人显示名').fill('雅澜运营负责人')
        id_region.get_by_label('建设维护人口令').fill('yalan-ui-2026')
        id_region.get_by_role('button', name='建立/登录维护身份').click()
        b1.wait_for_function('() => window.__heldOpAuth === true', timeout=8000)
        b1.get_by_role('button', name='验证中…').wait_for(state='visible', timeout=5000)
        waiting_submit = b1.get_by_role('button', name='等待维护身份验证…')
        waiting_submit.wait_for(state='visible', timeout=5000)
        assert waiting_submit.is_disabled(), 'Item 05b: 发起建设 MUST be disabled while maintenance identity auth is in flight!'
        assert len(b1_sys_posts) == 0, 'Item 05b: no system creation allowed during in-flight auth!'
        # Release delayed auth -> succeeds -> 发起建设 becomes enabled and binds system to op:yalan-ui-ops!
        b1.evaluate('() => window.__releaseOpAuth && window.__releaseOpAuth()')
        id_region.get_by_text('op:yalan-ui-ops').first.wait_for(state='visible', timeout=8000)
        submit_btn = b1.get_by_role('button', name='发起建设', exact=True)
        submit_btn.wait_for(state='visible', timeout=5000)
        assert not submit_btn.is_disabled(), 'Item 05b: 发起建设 must re-enable after auth succeeds'
        submit_btn.click()
        b1.locator('#studio-create-form').wait_for(state='hidden', timeout=10000)
        assert len(b1_sys_posts) == 1, f'Item 05b: expected strictly 1 system create, got {len(b1_sys_posts)}'

        # Return to 覆盖与缺口 and initialize first pack purely via UI!
        b1.get_by_role('navigation', name='体系工作台视图').get_by_role('button', name='覆盖与缺口').click()
        b1.get_by_role('heading', name='企业会员运营资产包').wait_for(state='visible', timeout=10000)
        b1.get_by_role('button', name='初始化本企业会员运营包').click()
        b1.get_by_role('button', name='建设草案').wait_for(state='visible', timeout=8000)

        # Retrieve pack_b id via Browser 1 cookie and verify persisted owner is op:yalan-ui-ops, add purpose, publish v1.0 via UI!
        b1_cookies = b1_ctx.cookies()
        b1_cookie_hdr = '; '.join(f"{c['name']}={c['value']}" for c in b1_cookies)
        pack_b_res = api(f"/api/studio/enterprise-packs?enterpriseId={eid_b}&domain=member-operations&projectId={proj_b_owner['id']}", cookie=b1_cookie_hdr)
        assert pack_b_res['grantAuthorityGuidance']['maintainerOperatorId'] == 'op:yalan-ui-ops', f'Item 05b: pack owner was not bound to op:yalan-ui-ops! {pack_b_res}'
        pack_b = pack_b_res['packs'][0]
        api(f"/api/studio/enterprise-packs/{pack_b['id']}/purposes", 'POST', {
            'requestId': str(_uuid.uuid4()),
            'projectId': proj_b_owner['id'],
            'purposeKey': 'store_30d_repurchase',
            'title': '雅澜甲乙两店 6 月会员 30 日复购率',
            'businessQuestion': '甲乙两店 6 月首购会员在 7 月底前的 30 日复购率',
            'subjectUnit': 'brand_account',
            'windowDays': 30,
            'scope': {'brand': '雅澜', 'channel': '直营门店', 'period': '2026-06~2026-07', 'stores': ['甲店', '乙店'], 'scopeKey': 'yalan:ab:30d'},
            'tier': 'definition-reference',
            'businessStatus': 'active',
            'originalGoal': '复购口径与重算',
            'remainingGaps': [],
            'exclusions': ['全额退款'],
            'completionCriteria': '发布 v1.0',
            'policyEffectiveFrom': '2026-06-01',
            'dataCutoffAt': '2026-07-31',
        }, cookie=b1_cookie_hdr)
        b1.reload(wait_until='domcontentloaded')
        b1.get_by_role('button', name='分析资产').click()
        b1.get_by_role('button', name='体系工作台').click()
        b1.get_by_label('当前企业').select_option(eid_b)
        b1.get_by_role('navigation', name='体系工作台视图').get_by_role('button', name='覆盖与缺口').click()
        b1.get_by_role('heading', name='企业会员运营资产包').wait_for(state='visible', timeout=10000)
        b1.get_by_role('button', name='建设草案').click()
        b1.get_by_role('button', name='生成一份发布预览').click()
        b1.locator('dialog[open]').get_by_role('button', name='确认并按用途发布').click()
        b1.locator('dialog[open]').wait_for(state='hidden', timeout=10000)
        b1_ctx.close()

        # Browser 2 (BRAND NEW CONTEXT — zero cookies from Browser 1!)
        b2_ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
        b2 = b2_ctx.new_page()
        b2.goto(f"{base}/?project={proj_b_owner['id']}", wait_until='domcontentloaded')
        b2.get_by_role('button', name='分析资产').click()
        b2.get_by_role('button', name='体系工作台').click()
        b2.get_by_label('当前企业').select_option(eid_b)
        b2.get_by_role('navigation', name='体系工作台视图').get_by_role('button', name='覆盖与缺口').click()
        b2.get_by_role('heading', name='企业会员运营资产包').wait_for(state='visible', timeout=10000)
        b2.get_by_role('button', name='三层资源授权').click()

        # Blocked guidance MUST tell WHO, WHERE, WHAT — and NEVER leak passcodes/tokens!
        guidance_box = b2.locator('[aria-label="授权权限引导"]')
        guidance_box.wait_for(state='visible')
        guidance_text = guidance_box.inner_text()
        assert '雅澜运营负责人' in guidance_text and 'op:yalan-ui-ops' in guidance_text, f'Item 05: missing maintainer name/id in guidance: {guidance_text}'
        assert '雅澜建设权责项目' in guidance_text, f'Item 05: missing owner project in guidance: {guidance_text}'
        assert 'yalan-ui-2026' not in guidance_text and 'salt' not in guidance_text.lower() and 'hash' not in guidance_text.lower()
        assert b2.get_by_role('button', name='保存资源授权').count() == 0, 'Item 05: unauthenticated Browser 2 must not see grant form'

        # Try another operator (non-owner) -> stays read-only!
        grants_auth = b2.locator('[aria-label="当前 Host 认证操作者身份"]')
        grants_auth.get_by_label('业务操作者标识').fill('other-analyst')
        grants_auth.get_by_label('业务操作者姓名或岗位').fill('其他分析师')
        grants_auth.get_by_label('操作者口令').fill('other-2026')
        grants_auth.get_by_role('button', name='注册/切换认证操作者').click()
        b2.wait_for_timeout(600)
        assert b2.locator('[aria-label="授权权限引导"]').is_visible(), 'Item 05: non-owner operator must stay read-only!'
        assert b2.get_by_role('button', name='保存资源授权').count() == 0

        # Re-authenticate as original named maintainer yalan-ui-ops purely via UI!
        grants_auth.get_by_label('业务操作者标识').fill('yalan-ui-ops')
        grants_auth.get_by_label('操作者口令').fill('yalan-ui-2026')
        grants_auth.get_by_role('button', name='注册/切换认证操作者').click()
        b2.get_by_role('button', name='保存资源授权').wait_for(state='visible', timeout=8000)

        # Grant T05 read-detail-recalculate for store_30d_repurchase, 甲店/乙店, 2026-06-01..2026-07-31, 3 CSVs purely via UI!
        grant_form = b2.locator('form', has_text='新增项目资源授权')
        grant_form.locator('select').nth(0).select_option(proj_b_t05['id'])
        grant_form.locator('select').nth(1).select_option('read-detail-recalculate')
        grant_form.locator('input[placeholder*="星桥直营店"]').fill('甲店、乙店')
        grant_form.locator('input[placeholder*="020_clean"]').fill('020_clean/members.csv、020_clean/orders.csv、020_clean/refunds.csv')
        grant_form.locator('label:has-text("purposeKeys") input').fill('store_30d_repurchase')
        grant_form.locator('label:has-text("数据期间起") input').fill('2026-06-01')
        grant_form.locator('label:has-text("数据期间止") input').fill('2026-07-31')
        grant_form.locator('label:has-text("授权依据") input').fill('T05 甲乙两店三表明细重算授权')
        grant_form.get_by_role('button', name='保存资源授权').click()
        b2.get_by_text('T05 门店复购分析项目').first.wait_for(state='visible', timeout=8000)
        b2.get_by_text('读取明细重算').first.wait_for(state='visible', timeout=8000)
        b2_ctx.close()

        # Browser 3 (Independent consumer T05 context): new task reads 3 authorized CSVs & dynamically recalculates 2/3 from returned rows!
        b3_ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
        b3 = b3_ctx.new_page()
        b3.goto(f"{base}/?project={proj_b_t05['id']}", wait_until='domcontentloaded')
        b3.get_by_role('button', name='新建第一个任务').click()
        b3.locator('dialog[open] #task-name').fill('T05 独立三表重算验证')
        b3.locator('dialog[open]').get_by_role('button', name='创建任务').click()
        b3.locator('#message-input').wait_for(state='visible')
        llm_state['tool_results_seen'].clear()
        b3.locator('#message-input').fill('请读取获准的三张明细表逐笔重算甲乙两店 6 月会员 30 日复购率并说明分子、分母与排除项。')
        b3.get_by_role('button', name='发送消息').click()
        b3.locator('.message.assistant').first.wait_for(state='visible', timeout=20000)
        reply = b3.locator('.message.assistant').first.inner_text()
        assert '甲店分母2、分子1' in reply and '乙店分母1、分子1' in reply and '合计分母3、分子2' in reply, f'Item 05: dynamic CSV recalculation mismatch! reply={reply}'
        assert 'members=3, orders=6, refunds=1' in reply, f'Item 05: filtered CSV row counts mismatch! reply={reply}'
        assert '丙店泄漏=False' in reply and '8月超期泄漏=False' in reply, f'Item 05: unauthorized store/period leaked! reply={reply}'
        joined_tools = '\n'.join(llm_state['tool_results_seen'])
        assert 'M999' not in joined_tools, 'Item 05: unlisted_extra.csv leaked!'
        print('PASS [Browser Item 05] In-flight auth race guard + wrong-passcode preservation + empty enterprise pure-UI named maintainer -> Browser 2 re-auth -> grant T05 -> dynamic row-derived 2/3 recalculate verified!')
        b3_ctx.close()

        # 5c: Confirm original temporary-session creation path (without clicking named auth) still works cleanly!
        ent_c = api('/api/studio/enterprises', 'POST', {'name': '临时会话创建对照企业'})
        proj_c = api('/api/projects', 'POST', {'name': '临时会话建设项目'})['project']
        api('/api/studio/enterprise-associations', 'POST', {'kind': 'project', 'entityId': proj_c['id'], 'enterpriseId': ent_c['id']})
        b4_ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
        b4 = b4_ctx.new_page()
        b4.goto(f"{base}/?project={proj_c['id']}", wait_until='domcontentloaded')
        b4.get_by_role('button', name='分析资产').click()
        b4.get_by_role('button', name='体系工作台').click()
        b4.get_by_label('当前企业').select_option(ent_c['id'])
        b4.get_by_role('navigation', name='体系工作台视图').get_by_role('button', name='建设与演进').click()
        b4.get_by_role('button', name='＋ 发起体系建设').click()
        b4.locator('#studio-create-form').wait_for(state='visible')
        b4.locator('#studio-new-project').select_option(proj_c['id'])
        b4.locator('#studio-new-goal').fill('验证未启用具名认证的临时会话创建路径仍保持可用')
        b4.get_by_role('button', name='发起建设', exact=True).click()
        b4.locator('#studio-create-form').wait_for(state='hidden', timeout=10000)
        b4_ctx.close()
        print('PASS [Browser Item 05c] Original temporary-session system creation path remains intact')

        browser.close()
        print('ALL_ROUND2_BROWSER_TESTS_PASSED')
finally:
    if proc:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
    llm_server.shutdown()
    shutil.rmtree(TMP_ROOT, ignore_errors=True)
