import { writeFileSync } from 'node:fs';
const fetchOriginal = globalThis.fetch;
const code = process.env.OPTRA_OBS_INJECT_CODE ?? 'native_snapshot_incomplete';
const injectionMethod = process.env.OPTRA_OBS_INJECT_METHOD ?? 'GET';
const receiptPath = process.env.OPTRA_OBS_RECEIPT;
const armed = new Set();
const receipt = { code, injectionMethod, injections: 0, taskPosts: 0, armedGets: 0, observation: null };
const save = () => { if (receiptPath) writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n'); };
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const response = await fetchOriginal(input, init);
  const taskPost = method === 'POST' && /^\/api\/projects\/[a-f0-9-]+\/tasks\/[a-f0-9-]+\/messages$/.test(url.pathname);
  if (taskPost) {
    receipt.taskPosts++;
    if (response.status === 202) armed.add(url.pathname.slice(0, -'/messages'.length));
  }
  const taskObservation = method === 'GET' && armed.has(url.pathname);
  if (taskObservation) receipt.armedGets++;
  const firstGetEligible = taskObservation && receipt.armedGets === 1 && (response.status === 200 || (response.status === 409 && (await response.clone().json()).code === 'native_snapshot_incomplete'));
  if (!receipt.injections && ((injectionMethod === 'GET' && firstGetEligible) || (injectionMethod === 'POST' && taskPost && response.status === 202))) {
    receipt.injections++;
    receipt.observation = { method, route: url.pathname, originalStatus: response.status, injectedStatus: 409, code, armedGetOrdinal: receipt.armedGets };
    await response.arrayBuffer();
    save();
    return new Response(JSON.stringify({ code, accepted: false, message: 'Synthetic one-observation response, original Host already answered.' }), { status: 409, headers: { 'content-type': 'application/json' } });
  }
  return response;
};
process.on('exit', save);
