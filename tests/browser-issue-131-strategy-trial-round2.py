#!/usr/bin/env python3
"""Isolated headless Chromium E2E verification for GitHub Issue #131 (Strategy Selection Trial Round 2).

Covers all 5 items (A-E) against real Host + real Pi 1.4.0 + local synthetic OpenAI-compatible Provider:
- E: Required semantics & alert/focus on InitiativeEditorDialog (empty scopeId, half-filled scope row, valid creation)
- A: Upload normal TXT, unknown upload recovery (network abort -> unreachable launch/log guidance, reload persistence,
     read-only check when saved/not-saved, mismatched file rejection, verified re-select same operationId retry,
     explicit new upload distinct record, scope switch isolation)
- B: Candidate save role-field rejection with safe details.issues + Agent self-correction to legal 0-goal draft
- C: Single-candidate main discussion readback entry + ReviseDialog baseline preview + mismatched-block clarification
     feedback + inline main discussion readback + reselect target block & adopt v2 (untouched block byte-identical)
- D: Upfront 0-goal notice before lock & in release review / publish confirm; unlocked-draft goal supplementation via
     candidate session -> lock -> dual verify -> release -> handoff to current department; legal 0-goal publish +
     locked parent -> new child candidate with parentVersion context
- Governance / History / Withdrawal / Responsive (1440x900, 390x844) / Keyboard Escape / Zero external traffic
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.request
import uuid as _uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
TMP_ROOT = tempfile.mkdtemp(prefix='optracall-issue-131-browser-')
DATA_ROOT = os.path.join(TMP_ROOT, 'data')
PROJECTS_ROOT = os.path.join(TMP_ROOT, 'projects')
FILES_ROOT = os.path.join(TMP_ROOT, 'sample-files')
UI_ROOT = os.path.join(REPO_ROOT, 'dist')
SHOT_DIR = os.path.join(REPO_ROOT, '.local', 'issue-131', 'browser')
os.makedirs(FILES_ROOT, exist_ok=True)
os.makedirs(SHOT_DIR, exist_ok=True)


def message_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return ''.join(part.get('text', '') for part in content if isinstance(part, dict) and isinstance(part.get('text'), str))
    return ''


class SyntheticProviderState:
    def __init__(self):
        self.lock = threading.Lock()
        self.requests = 0
        self.verify_targets = {}
        self.observations = {
            'item_b_field_error_seen': False,
            'item_d_parent_version_seen': False,
        }

    def decide(self, messages):
        last_user_idx = -1
        for i in range(len(messages) - 1, -1, -1):
            if messages[i].get('role') == 'user':
                last_user_idx = i
                break
        recent_tools = [m for m in messages[last_user_idx + 1:] if m.get('role') == 'tool']
        user_text = message_text(messages[last_user_idx].get('content', '')) if last_user_idx >= 0 else ''
        system_text = '\n'.join(message_text(m.get('content', '')) for m in messages if m.get('role') in ('system', 'developer'))
        step = len(recent_tools)

        # 1. Dual verification turns (causal / logic gate)
        if '"lockedCandidate"' in user_text or 'initiative-save-verification' in system_text:
            if step > 0:
                return {'text': '检验结论已按锁定版与指纹提交。'}
            first_line = user_text.split('\n', 1)[0]
            locked = json.loads(first_line)['lockedCandidate']
            cid = locked['candidateId']
            no = locked['no']
            sha = locked['contentSha256']
            return {
                'calls': [{
                    'name': 'strategy_goals',
                    'arguments': {
                        'action': 'initiative-save-verification',
                        'verdict': 'pass',
                        'evidence': '已核对锁定候选与开题基线，因果链与核心取舍一致，予以通过。',
                        'verificationSources': [{'kind': 'candidate', 'ref': f'{cid}:{no}', 'sha256': sha}],
                    },
                }],
            }

        # 2. Scoped revision proposal turns (Item C)
        if '"proposal":{"proposalId"' in user_text or '"proposalId"' in user_text:
            pid_match = re.search(r'"proposalId"\s*:\s*"([a-f0-9-]+)"', user_text)
            bid_match = re.search(r'"blockId"\s*:\s*"([^"]+)"', user_text)
            pid = pid_match.group(1) if pid_match else ''
            bid = bid_match.group(1) if bid_match else ''
            if step > 0:
                return {'text': '已提交预算与资源块拟改补丁，请核对差异后决定是否采纳。'}
            if bid == 'positioning' and '预算' in user_text:
                return {
                    'text': '预算在「预算与资源」块，当前选中「定位与增长」块不包含预算数字，请确认改选「预算与资源」块后再拟改。',
                }
            if bid == 'budget':
                return {
                    'calls': [{
                        'name': 'strategy_goals',
                        'arguments': {
                            'action': 'initiative-propose-revision',
                            'proposalId': pid,
                            'newText': '2027 试点投入预算上限调整为 50 万元，先覆盖 2 家成熟门店。',
                        },
                    }],
                }
            return {'text': '当前所选块与请求不匹配，请核对修改位置后再提交。'}

        # 3. Unlocked candidate session goal supplementation (Item D)
        if '补充两条可承接目标' in user_text:
            if step == 0:
                return {'calls': [{'name': 'strategy_goals', 'arguments': {'action': 'initiative-read-candidate'}}]}
            if step == 1:
                readback = json.loads(message_text(recent_tools[0].get('content', '{}')))
                blocks = readback['candidate']['blocks']
                return {
                    'calls': [{
                        'name': 'strategy_goals',
                        'arguments': {
                            'action': 'initiative-save-candidate',
                            'operationId': str(_uuid.uuid4()),
                            'candidateBlocks': blocks,
                            'candidateGoals': ['90天二购率提升至12%', '试点门店导购触达覆盖率达到80%'],
                        },
                    }],
                }
            return {'text': '已读回原正文并补充 2 条可承接战略目标，原章节保留。'}

        # 4. Child candidate created from locked parent (Item D)
        if '"parentVersion"' in user_text:
            with self.lock:
                self.observations['item_d_parent_version_seen'] = True
            if step > 0:
                return {'text': '已基于父版新建候选并补齐可承接目标，请重新锁定并检验。'}
            return {
                'calls': [{
                    'name': 'strategy_goals',
                    'arguments': {
                        'action': 'initiative-save-candidate',
                        'operationId': str(_uuid.uuid4()),
                        'candidateBlocks': [
                            {'id': 'positioning', 'label': '定位与增长', 'text': '门店效率优先：优化排班与动线，提升单店坪效。'},
                            {'id': 'budget', 'label': '预算与资源', 'text': '2027 试点投入 40 万元，覆盖 2 家标杆门店。'},
                        ],
                        'candidateGoals': ['试点门店单店人效同比提升 15%'],
                    },
                }],
            }

        # 5. Candidate 1 creation (Item B invalid-field self-correction -> 0-goal legal draft)
        if '会员复购优先' in user_text:
            if step == 0:
                return {
                    'calls': [{
                        'name': 'strategy_goals',
                        'arguments': {
                            'action': 'initiative-save-candidate',
                            'operationId': str(_uuid.uuid4()),
                            'version': 1,
                            'candidateBlocks': [
                                {'id': 'positioning', 'label': '定位与增长', 'text': '聚焦华东存量门店会员复购，先试点再推广。'},
                                {'id': 'budget', 'label': '预算与资源', 'text': '2027 试点投入预算 80 万元，覆盖 3 家门店。'},
                            ],
                        },
                    }],
                }
            if step == 1:
                err_text = message_text(recent_tools[0].get('content', ''))
                if 'strategy_candidate_fields_invalid' in err_text and '"path":"version"' in err_text:
                    with self.lock:
                        self.observations['item_b_field_error_seen'] = True
                return {
                    'calls': [{
                        'name': 'strategy_goals',
                        'arguments': {
                            'action': 'initiative-save-candidate',
                            'operationId': str(_uuid.uuid4()),
                            'candidateBlocks': [
                                {'id': 'positioning', 'label': '定位与增长', 'text': '聚焦华东存量门店会员复购，先试点再推广。'},
                                {'id': 'budget', 'label': '预算与资源', 'text': '2027 试点投入预算 80 万元，覆盖 3 家门店。'},
                            ],
                        },
                    }],
                }
            return {'text': '已修正保存参数并保存候选初稿（暂未列可承接目标）。'}

        # 6. Candidate 2 creation (0-goal legal publish path)
        if '门店效率优先' in user_text:
            if step > 0:
                return {'text': '无目标候选「门店效率优先」已保存。'}
            return {
                'calls': [{
                    'name': 'strategy_goals',
                    'arguments': {
                        'action': 'initiative-save-candidate',
                        'operationId': str(_uuid.uuid4()),
                        'candidateBlocks': [
                            {'id': 'positioning', 'label': '定位与增长', 'text': '门店效率优先：优化排班与动线，提升单店坪效。'},
                            {'id': 'budget', 'label': '预算与资源', 'text': '2027 试点投入 40 万元，覆盖 2 家标杆门店。'},
                        ],
                    },
                }],
            }

        # 7. Default main discussion response
        return {'text': '已记录本轮战略讨论要点，随时可继续整理开题或核对候选。'}


provider_state = SyntheticProviderState()


class ProviderHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_POST(self):
        if not self.path.endswith('/chat/completions'):
            self.send_response(404)
            self.end_headers()
            return
        auth = self.headers.get('Authorization', '')
        if not auth.startswith('Bearer synthetic-'):
            self.send_response(401)
            self.end_headers()
            return
        length = int(self.headers.get('Content-Length', '0'))
        body = json.loads(self.rfile.read(length).decode('utf-8'))
        with provider_state.lock:
            provider_state.requests += 1
            req_no = provider_state.requests
        reply = provider_state.decide(body.get('messages', []))
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()

        def send(delta, finish=None):
            chunk = {
                'id': f'synthetic-{req_no}',
                'object': 'chat.completion.chunk',
                'created': 1,
                'model': body.get('model', 'synthetic'),
                'choices': [{'index': 0, 'delta': delta, 'finish_reason': finish}],
            }
            self.wfile.write(f'data: {json.dumps(chunk, ensure_ascii=False)}\n\n'.encode('utf-8'))
            self.wfile.flush()

        send({'role': 'assistant', 'content': ''})
        if reply.get('text'):
            txt = reply['text']
            cut = max(1, len(txt) // 2)
            send({'content': txt[:cut]})
            send({'content': txt[cut:]})
        calls = reply.get('calls') or []
        for idx, call in enumerate(calls):
            send({'tool_calls': [{'index': idx, 'id': f'call_{req_no}_{idx}', 'type': 'function', 'function': {'name': call['name'], 'arguments': ''}}]})
            args_str = json.dumps(call['arguments'], ensure_ascii=False)
            cut = len(args_str) // 2
            send({'tool_calls': [{'index': idx, 'function': {'arguments': args_str[:cut]}}]})
            send({'tool_calls': [{'index': idx, 'function': {'arguments': args_str[cut:]}}]})
        send({}, 'tool_calls' if calls else 'stop')
        self.wfile.write(b'data: [DONE]\n\n')
        self.wfile.flush()


provider_server = ThreadingHTTPServer(('127.0.0.1', 0), ProviderHandler)
provider_port = provider_server.server_address[1]
provider_thread = threading.Thread(target=provider_server.serve_forever, daemon=True)
provider_thread.start()

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
    deadline = time.time() + 20
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
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode('utf-8'))

    # Configure synthetic local provider
    api('/api/configuration', 'PUT', {
        'name': 'Issue131 Synthetic',
        'provider': 'openai-compatible',
        'baseUrl': f'http://127.0.0.1:{provider_port}/v1',
        'model': 'synthetic-issue-131',
        'apiKey': 'synthetic-issue-131-only',
    })

    # Prepare local synthetic TXT files
    file_ok = os.path.join(FILES_ROOT, '门店经营摘要.txt')
    file_rec = os.path.join(FILES_ROOT, '待核复购样本.txt')
    file_wrong = os.path.join(FILES_ROOT, '错误替代文件.txt')
    with open(file_ok, 'wb') as f:
        f.write('禾岸华东区合成资料：2026 Q1 客流稳定，新客首购后 90 天复购有提升空间。\n'.encode('utf-8'))
    rec_bytes = '禾岸华东区待核恢复样本：用于验证失联后按原 operationId 与 SHA-256 恢复。\n'.encode('utf-8')
    with open(file_rec, 'wb') as f:
        f.write(rec_bytes)
    rec_sha = hashlib.sha256(rec_bytes).hexdigest()
    with open(file_wrong, 'wb') as f:
        f.write('这是另一份不同内容的文件。\n'.encode('utf-8'))

    page_errors = []
    console_errors = []
    external_requests = []
    report = {'checks': {}}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 900})
        page = context.new_page()
        page.on('pageerror', lambda err: page_errors.append(str(err)))
        page.on('console', lambda msg: console_errors.append(msg.text) if msg.type == 'error' else None)

        def block_external(route):
            url = route.request.url
            if url.startswith(f'http://127.0.0.1:{port}') or url.startswith('data:') or url.startswith('blob:'):
                route.continue_()
            else:
                external_requests.append(url)
                route.abort()

        page.route('**/*', block_external)
        try:
            page.goto(base, wait_until='networkidle')
            page.get_by_role('button', name='战略选择').click()
            page.get_by_role('button', name='新建战略事项').wait_for(timeout=10_000)

            # ========================
            # ITEM E: Required field semantics & alert/focus on InitiativeEditorDialog
            # ========================
            page.get_by_role('button', name='新建战略事项').click()
            dialog = page.get_by_role('dialog')
            dialog.wait_for(timeout=10_000)
            assert dialog.locator('label[for="si-initiative-title"] span', has_text='必填').is_visible()
            assert dialog.locator('label[for="si-scope-name-0"] span', has_text='必填').is_visible()
            assert dialog.locator('label[for="si-scope-id-0"] span', has_text='必填').is_visible()
            assert dialog.locator('#si-scope-id-0').get_attribute('aria-required') == 'true'
            assert dialog.locator('#si-scope-enterprise-0').get_attribute('aria-required') is None

            # Fill title + scope name, leave 归属标识 empty -> submit must show visible alert, mark aria-invalid, focus #si-scope-id-0, create 0 initiatives
            dialog.locator('#si-initiative-title').fill('禾岸华东增长战略')
            dialog.locator('#si-scope-name-0').fill('禾岸华东区')
            dialog.get_by_role('button', name='创建事项').click()
            alert = dialog.locator('[role="alert"]')
            alert.wait_for(timeout=5_000)
            assert '归属标识' in alert.inner_text()
            assert dialog.locator('#si-scope-id-0').get_attribute('aria-invalid') == 'true'
            focused_id = page.evaluate('document.activeElement && document.activeElement.id')
            assert focused_id == 'si-scope-id-0', f'expected focus on #si-scope-id-0, got {focused_id}'
            assert len(api('/api/strategy/initiatives')['initiatives']) == 0, 'empty scopeId must create 0 initiatives (no silent failure)'
            page.screenshot(path=os.path.join(SHOT_DIR, '01-item-e-required-alert.png'))

            # Half-filled 2nd scope row must NOT be silently dropped
            dialog.locator('#si-scope-id-0').fill('hean-east')
            dialog.get_by_role('button', name='＋ 添加范围').click()
            dialog.locator('#si-scope-name-1').fill('禾岸华南区')
            dialog.get_by_role('button', name='创建事项').click()
            assert '范围 2' in alert.inner_text() and '归属标识' in alert.inner_text()
            assert page.evaluate('document.activeElement && document.activeElement.id') == 'si-scope-id-1'

            # Complete 2nd scope row and create initiative cleanly
            dialog.locator('#si-scope-id-1').fill('hean-south')
            dialog.get_by_role('button', name='创建事项').click()
            dialog.wait_for(state='detached', timeout=10_000)
            inits = api('/api/strategy/initiatives')['initiatives']
            assert len(inits) == 1
            initiative_id = inits[0]['id']
            report['checks']['item_e_required_semantics'] = 'PASS (silent creation failure NOT reproduced)'

            # ========================
            # ITEM A: Upload normal + UNKNOWN recovery + reload reselect + scope isolation
            # ========================
            # 1. Normal TXT upload
            file_input = page.locator('input[aria-label="选择上传文件"]')
            file_input.set_input_files(file_ok)
            page.get_by_text('门店经营摘要.txt').first.wait_for(timeout=10_000)
            page.get_by_role('button', name='＋ 上传资料').wait_for(timeout=10_000)

            # 2. Simulate upload disconnect (network abort -> status === 0 / unreachable)
            abort_once = {'active': True, 'captured_ops': []}

            def intercept_files(route):
                req = route.request
                if req.method == 'POST' and f'/api/strategy/initiatives/{initiative_id}/files' in req.url:
                    try:
                        payload = json.loads(req.post_data or '{}')
                        if payload.get('operationId'):
                            abort_once['captured_ops'].append(payload['operationId'])
                    except Exception:
                        pass
                    if abort_once['active']:
                        abort_once['active'] = False
                        route.abort('connectionrefused')
                        return
                route.continue_()

            page.route(f'**/api/strategy/initiatives/{initiative_id}/files*', intercept_files)
            file_input.set_input_files(file_rec)
            recovery_box = page.locator('[aria-label="待核上传记录"]')
            recovery_box.wait_for(timeout=10_000)
            rec_text = recovery_box.inner_text()
            assert 'UNKNOWN' in rec_text
            assert '启动 OptraCall.command' in rec_text
            assert '~/.optracall/trial/logs/' in rec_text
            assert len(abort_once['captured_ops']) == 1
            first_op_id = abort_once['captured_ops'][0]
            page.screenshot(path=os.path.join(SHOT_DIR, '02-item-a-upload-unknown.png'))

            # 3. Scope switch isolates pending upload
            page.get_by_label('适用范围').select_option('department::hean-south')
            assert page.locator('[aria-label="待核上传记录"]').count() == 0, 'pending upload must not leak across scopes'
            page.get_by_label('适用范围').select_option('department::hean-east')
            recovery_box.wait_for(timeout=10_000)

            # 4. Page reload preserves pending upload metadata (no bytes in memory)
            page.reload(wait_until='networkidle')
            page.get_by_role('button', name='战略选择').click()
            recovery_box = page.locator('[aria-label="待核上传记录"]')
            recovery_box.wait_for(timeout=10_000)
            recovery_box.locator('summary', has_text='原操作编号与指纹').click()
            assert first_op_id in recovery_box.inner_text()
            assert rec_sha in recovery_box.inner_text()

            # Read-only check when NOT saved on Host -> transitions to not-found & prompts verified reselect
            recovery_box.get_by_role('button', name='核对原上传结果').click()
            recovery_box.get_by_text('尚未发现原上传记录').wait_for(timeout=10_000)

            # Mismatched file rejected before network POST
            reselect_input = page.locator('input[aria-label="重选原文件并按原编号重试"]')
            reselect_input.set_input_files(file_wrong)
            page.get_by_text('文件名或 SHA-256 指纹不一致').wait_for(timeout=5_000)

            # Re-selecting exact original file retries with SAME operationId -> 1 logical record!
            reselect_input.set_input_files(file_rec)
            page.get_by_text('待核复购样本.txt').first.wait_for(timeout=10_000)
            recovery_box.wait_for(state='detached', timeout=10_000)
            assert len(abort_once['captured_ops']) == 2
            assert abort_once['captured_ops'][1] == first_op_id, 're-selected retry must reuse exact same operationId'
            files_after = api(f'/api/strategy/initiatives/{initiative_id}/files')['files']
            rec_matches = [f for f in files_after if f['name'] == '待核复购样本.txt']
            assert len(rec_matches) == 1 and rec_matches[0]['operationId'] == first_op_id

            # 5. Simulate server-saved-then-response-lost: Host commits, client gets network reset -> read-only check resolves without duplicate
            saved_then_lost = {'active': True}

            def intercept_saved_lost(route):
                req = route.request
                if req.method == 'POST' and saved_then_lost['active'] and f'/api/strategy/initiatives/{initiative_id}/files' in req.url:
                    saved_then_lost['active'] = False
                    resp = route.fetch()
                    assert resp.status == 201
                    route.abort('connectionreset')
                    return
                route.continue_()

            page.unroute(f'**/api/strategy/initiatives/{initiative_id}/files*')
            page.route(f'**/api/strategy/initiatives/{initiative_id}/files*', intercept_saved_lost)
            file_input.set_input_files(file_wrong)
            recovery_box = page.locator('[aria-label="待核上传记录"]')
            recovery_box.wait_for(timeout=10_000)
            recovery_box.get_by_role('button', name='核对原上传结果').click()
            page.get_by_text('已核对原上传操作').wait_for(timeout=10_000)
            recovery_box.wait_for(state='detached', timeout=10_000)
            files_after_check = api(f'/api/strategy/initiatives/{initiative_id}/files')['files']
            assert len([f for f in files_after_check if f['name'] == '错误替代文件.txt']) == 1, 'read-only check resolved without duplicate'
            page.unroute(f'**/api/strategy/initiatives/{initiative_id}/files*')
            report['checks']['item_a_upload_recovery'] = 'PASS'

            # ========================
            # Seed Kickoff Report & Send 1 main discussion message so main session transcript exists
            # ========================
            scope_east = {'kind': 'department', 'id': 'hean-east', 'name': '禾岸华东区'}
            kickoff_fields = {
                'horizon': '2027–2029',
                'diagnosis': '华东门店客流稳定，增长缺口集中在新客首购后 90 天复购。',
                'propositions': [
                    {'id': 'P1', 'question': '会员复购能否带动增长？', 'whyItMatters': '决定资源投向。'},
                    {'id': 'P2', 'question': '试点预算上限如何控制？', 'whyItMatters': '决定风险边界。'},
                    {'id': 'P3', 'question': '导购触达工时能否承受？', 'whyItMatters': '决定落地可行性。'},
                ],
                'assumptions': '试点预算可控。',
                'evidenceGaps': '自然复购待补证。',
                'followUp': '候选须明确选择与放弃。',
            }
            rep = api(f'/api/strategy/initiatives/{initiative_id}/reports', 'POST', {
                'operationId': str(_uuid.uuid4()), 'fields': kickoff_fields, 'sources': [],
            })['version']
            api(f'/api/strategy/initiatives/{initiative_id}/reports/1/lock', 'POST', {
                'operationId': str(_uuid.uuid4()), 'sha256': rep['contentSha256'],
            })
            api(f'/api/strategy/initiatives/{initiative_id}/reports/1/apply', 'POST', {
                'operationId': str(_uuid.uuid4()), 'sha256': rep['contentSha256'], 'scope': scope_east,
            })
            page.reload(wait_until='networkidle')
            page.get_by_role('button', name='战略选择').click()
            page.get_by_role('button', name='进入方案成型').wait_for(timeout=10_000)

            # Send one main discussion turn on kickoff page to populate main transcript
            page.locator('#si-main-text').fill('请记住：试点优先控制预算上限。')
            page.get_by_role('button', name='发送讨论').click()
            page.get_by_text('已记录本轮战略讨论要点').wait_for(timeout=15_000)

            # Enter Plans phase
            page.get_by_role('button', name='进入方案成型').click()

            # ========================
            # ITEM B + ITEM C + ITEM D (Candidate 1)
            # ========================
            page.get_by_role('button', name='＋ 新建候选').click()
            cand_dialog = page.get_by_role('dialog')
            cand_dialog.locator('#si-candidate-title').fill('会员复购优先')
            cand_dialog.locator('#si-candidate-instruction').fill('基于锁定开题形成会员复购优先方案。')
            cand_dialog.get_by_role('button', name='启动独立会话').click()
            cand_dialog.wait_for(state='detached', timeout=10_000)

            # Wait for Candidate 1 to finish saving (Item B invalid-field self-correction -> 0-goal legal draft)
            page.get_by_text('聚焦华东存量门店会员复购，先试点再推广。').wait_for(timeout=20_000)
            assert provider_state.observations['item_b_field_error_seen'], 'Item B field error localization must be exercised in real Pi run'
            report['checks']['item_b_candidate_validation_self_repair'] = 'PASS'

            # Single-candidate page MUST show 「查看主会话讨论」 entry (Item C)
            page.get_by_role('button', name='查看主会话讨论').click()
            main_dlg = page.get_by_role('dialog')
            main_dlg.get_by_text('已记录本轮战略讨论要点').wait_for(timeout=10_000)
            # Keyboard Escape closes dialog
            page.keyboard.press('Escape')
            main_dlg.wait_for(state='detached', timeout=5_000)

            # Item C: Open ReviseDialog on Candidate 1 -> verify exact target baseline preview -> submit mismatched budget intent on default 'positioning' block
            page.get_by_role('button', name='限定修改').click()
            rev_dlg = page.get_by_role('dialog')
            baseline_box = rev_dlg.locator('[aria-label="当前所选块原文"]')
            baseline_box.wait_for(timeout=5_000)
            assert '定位与增长' in baseline_box.inner_text()
            assert '聚焦华东存量门店会员复购' in baseline_box.inner_text()
            rev_dlg.locator('#si-revise-request').fill('请把试点预算上限改为 50 万元。')
            rev_dlg.get_by_role('button', name='请 Agent 拟改').click()

            # Clarification feedback appears directly in ReviseDialog!
            feedback_box = rev_dlg.locator('[aria-label="本轮拟改反馈"]')
            feedback_box.wait_for(timeout=20_000)
            assert '预算在「预算与资源」块' in feedback_box.inner_text()
            page.screenshot(path=os.path.join(SHOT_DIR, '03-item-c-clarification-feedback.png'))

            # Inline main discussion readback inside ReviseDialog
            feedback_box.get_by_role('button', name='查看主会话原讨论').click()
            rev_dlg.locator('[aria-label="主会话原讨论只读回看"]').get_by_text('预算在「预算与资源」块').first.wait_for(timeout=10_000)

            # Reselect 'budget' block -> baseline preview updates -> Agent proposes patch -> adopt v2!
            rev_dlg.locator('#si-revise-block').select_option('budget')
            assert '预算与资源' in baseline_box.inner_text()
            assert '80 万元' in baseline_box.inner_text()
            rev_dlg.locator('#si-revise-request').fill('请把试点预算上限改为 50 万元，先做 2 家店。')
            rev_dlg.get_by_role('button', name='请 Agent 拟改').click()
            rev_dlg.get_by_role('button', name='采纳并另存新版本').wait_for(timeout=20_000)
            assert '50 万元' in rev_dlg.locator('.si-diff-after').inner_text()
            rev_dlg.get_by_role('button', name='采纳并另存新版本').click()
            rev_dlg.wait_for(state='detached', timeout=10_000)
            page.get_by_text('2027 试点投入预算上限调整为 50 万元，先覆盖 2 家成熟门店。').wait_for(timeout=10_000)
            # Untouched positioning block keeps exact original bytes
            assert '聚焦华东存量门店会员复购，先试点再推广。' in page.locator('[aria-label="候选详情"]').inner_text()
            report['checks']['item_c_revise_clarification_and_adopt'] = 'PASS'

            # ========================
            # ITEM D (Path 1): 0-goal upfront notice -> unlocked draft supplements goals via candidate session -> lock -> verify -> release -> handoff
            # ========================
            detail_panel = page.locator('[aria-label="候选详情"]')
            assert '可承接战略目标（0 个）' in detail_panel.inner_text()
            assert '当前可承接目标 0 个' in detail_panel.inner_text()

            # Click 审核并锁定 -> LockConfirmDialog warns 0 goals & offers 先回候选会话补充目标
            detail_panel.get_by_role('button', name='审核并锁定').click()
            lock_dlg = page.get_by_role('dialog')
            assert '可承接目标：0 个' in lock_dlg.inner_text()
            page.screenshot(path=os.path.join(SHOT_DIR, '04-item-d-lock-0-goal-notice.png'))
            lock_dlg.get_by_role('button', name='先回候选会话补充目标').click()

            # Now inside CandidateSessionDialog -> send natural language goal supplementation request
            sess_dlg = page.get_by_role('dialog')
            sess_dlg.locator('#si-candidate-text').wait_for(timeout=10_000)
            sess_dlg.locator('#si-candidate-text').fill('请读回当前正文并补充两条可承接目标。')
            sess_dlg.get_by_role('button', name='发送').click()
            sess_dlg.get_by_text('90天二购率提升至12%').wait_for(timeout=20_000)
            sess_dlg.get_by_text('可承接目标 2 个').wait_for(timeout=10_000)
            sess_dlg.get_by_role('button', name='关闭', exact=True).click()
            sess_dlg.wait_for(state='detached', timeout=5_000)

            # Lock Candidate 1 v2 now (shows 可承接目标：2 个)
            detail_panel.get_by_role('button', name='审核并锁定').click()
            lock_dlg = page.get_by_role('dialog')
            assert '可承接目标：2 个' in lock_dlg.inner_text()
            lock_dlg.get_by_role('button', name='确认锁定').click()
            lock_dlg.wait_for(state='detached', timeout=10_000)

            # Dual verification in StrategyCheckPanel
            page.get_by_role('button', name='启动检验').wait_for(timeout=10_000)
            page.get_by_role('button', name='启动检验').click()
            page.get_by_role('button', name='前往战略发布').wait_for(timeout=30_000)
            page.get_by_role('button', name='前往战略发布').click()

            # Release Review & Publish Confirm list the 2 goals
            release_panel = page.locator('[aria-label="战略发布"]')
            assert '可承接目标（2 个' in release_panel.inner_text()
            assert '90天二购率提升至12%' in release_panel.inner_text()
            release_panel.get_by_role('button', name='核对并正式发布').click()
            pub_dlg = page.get_by_role('dialog')
            assert '可承接目标（2 个）' in pub_dlg.inner_text()
            pub_dlg.locator('input[type="checkbox"]').check()
            pub_dlg.get_by_role('button', name='确认发布').click()
            pub_dlg.wait_for(state='detached', timeout=10_000)

            # Handoff to current department
            release_panel.get_by_role('button', name='带入目标管理').click()
            handoff_dlg = page.get_by_role('dialog')
            assert '当前战略范围' in handoff_dlg.inner_text()
            handoff_dlg.get_by_role('button', name='保存目标候选').click()
            handoff_dlg.wait_for(state='detached', timeout=10_000)
            release_panel.get_by_text('1 批目标候选已导入').wait_for(timeout=10_000)
            page.screenshot(path=os.path.join(SHOT_DIR, '05-item-d-published-and-handoff.png'))

            # Withdraw Candidate 1 publication -> confirm cannot republish or handoff
            release_panel.get_by_role('button', name='撤销发布').click()
            wd_dlg = page.get_by_role('dialog')
            wd_dlg.get_by_role('button', name='确认撤销发布').click()
            wd_dlg.wait_for(state='detached', timeout=10_000)
            release_panel.get_by_text('此版已撤销').wait_for(timeout=10_000)
            assert release_panel.get_by_role('button', name='带入目标管理').count() == 0

            # ========================
            # ITEM D (Path 2 & 3): Legal 0-goal publish + locked parent -> new child candidate with parentVersion
            # ========================
            page.get_by_role('button', name='战略共创').click()
            page.get_by_role('button', name='方案成型 · 战略候选').click()
            page.get_by_role('button', name='＋ 新建候选').click()
            c2_dlg = page.get_by_role('dialog')
            c2_dlg.locator('#si-candidate-title').fill('门店效率优先')
            c2_dlg.locator('#si-candidate-instruction').fill('形成门店效率优先方案。')
            c2_dlg.get_by_role('button', name='启动独立会话').click()
            c2_dlg.wait_for(state='detached', timeout=10_000)
            page.get_by_text('门店效率优先：优化排班与动线').wait_for(timeout=20_000)

            # Lock 0-goal Candidate 2 directly (still legal!)
            detail_panel.get_by_role('button', name='审核并锁定').click()
            lock2 = page.get_by_role('dialog')
            assert '可承接目标：0 个' in lock2.inner_text()
            lock2.get_by_role('button', name='确认锁定').click()
            lock2.wait_for(state='detached', timeout=10_000)

            # Dual verify & publish 0-goal Candidate 2 (verify upfront 0-goal notice in both StrategyReleaseReview and PublishConfirmDialog)
            page.get_by_role('button', name='启动检验').click()
            page.get_by_role('button', name='前往战略发布').wait_for(timeout=30_000)
            page.get_by_role('button', name='前往战略发布').click()
            assert '可承接目标：0 个' in release_panel.inner_text()
            release_panel.get_by_role('button', name='核对并正式发布').click()
            pub2 = page.get_by_role('dialog')
            assert '当前锁定版可承接目标 0 个' in pub2.inner_text()
            pub2.locator('input[type="checkbox"]').check()
            pub2.get_by_role('button', name='确认发布').click()
            pub2.wait_for(state='detached', timeout=10_000)
            release_panel.get_by_role('button', name='撤销发布').wait_for(timeout=10_000)

            # Go back to co-create, select locked Candidate 2, and spawn child candidate via 「基于此版新建候选补充目标」
            page.get_by_role('button', name='战略共创').click()
            page.get_by_role('button', name='方案成型 · 战略候选').click()
            detail_panel.get_by_role('button', name='基于此版新建候选补充目标').click()
            child_dlg = page.get_by_role('dialog')
            assert '基于 门店效率优先 · v1 新建候选' in child_dlg.inner_text()
            child_dlg.locator('#si-candidate-instruction').fill('保留父版正文，补充单店人效目标。')
            child_dlg.get_by_role('button', name='启动独立会话').click()
            child_dlg.wait_for(state='detached', timeout=10_000)
            page.get_by_text('试点门店单店人效同比提升 15%').wait_for(timeout=20_000)
            assert provider_state.observations['item_d_parent_version_seen'], 'child candidate must receive parentVersion context'
            report['checks']['item_d_goal_handoff_and_parent_child'] = 'PASS'

            # Check Version Ledger tab
            page.get_by_role('button', name='版本管理').click()
            versions_panel = page.locator('[aria-label="版本管理"]')
            versions_panel.get_by_text('父版 v1').first.wait_for(timeout=10_000)
            versions_text = versions_panel.inner_text()
            assert '当前有效' in versions_text and '已撤销' in versions_text and '已保存目标候选' in versions_text
            report['checks']['version_ledger'] = 'PASS'

            # ========================
            # Responsive viewport checks (1440x900 & 390x844, zero horizontal overflow)
            # ========================
            overflow_1440 = page.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth')
            assert not overflow_1440, 'horizontal overflow detected at 1440x900'
            page.set_viewport_size({'width': 390, 'height': 844})
            page.wait_for_timeout(300)
            page.screenshot(path=os.path.join(SHOT_DIR, '06-responsive-390x844.png'))
            overflow_390 = page.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth')
            assert not overflow_390, 'horizontal overflow detected at 390x844'
            report['checks']['responsive_1440_and_390'] = 'PASS'
        except Exception:
            try:
                page.screenshot(path=os.path.join(SHOT_DIR, 'failure.png'))
                print('DEBUG page_errors:', page_errors)
                print('DEBUG console_errors:', console_errors)
                print('DEBUG aside text:', page.locator('aside[aria-label="事项文件"]').inner_text() if page.locator('aside[aria-label="事项文件"]').count() else '(none)')
            except Exception:
                pass
            raise
        finally:
            browser.close()

    assert len(external_requests) == 0, f'unexpected external requests: {external_requests}'
    assert len(page_errors) == 0, f'unexpected page errors: {page_errors}'
    # Note: the intentional network-abort test causes browser console net::ERR_CONNECTION_REFUSED / ERR_CONNECTION_RESET logs;
    # assert zero non-network console errors!
    unexpected_console = [c for c in console_errors if 'ERR_CONNECTION_REFUSED' not in c and 'ERR_CONNECTION_RESET' not in c and 'Failed to load resource' not in c]
    assert len(unexpected_console) == 0, f'unexpected console errors: {unexpected_console}'

    report['external_requests'] = len(external_requests)
    report['page_errors'] = len(page_errors)
    report['unexpected_console_errors'] = len(unexpected_console)
    report['provider_requests'] = provider_state.requests
    report['observations'] = provider_state.observations
    print(json.dumps(report, ensure_ascii=False, indent=2))
finally:
    if proc is not None and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
    provider_server.shutdown()
    shutil.rmtree(TMP_ROOT, ignore_errors=True)
