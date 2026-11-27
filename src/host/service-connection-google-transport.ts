import type { McpTransportFactory } from '../agent/sdk.ts';
import { SERVICE_URLS } from './service-connection-types.ts';

type NativeTransport = ReturnType<McpTransportFactory>;
type NativeMessage = Parameters<NativeTransport['send']>[0];
type NativeSendOptions = NonNullable<Parameters<NativeTransport['send']>[1]>;
type NativeAuthProvider = Parameters<McpTransportFactory>[2];
export type GoogleElicitationResponse = { action: 'accept'; content: Record<string, string | number | boolean | string[]> } | { action: 'decline' | 'cancel' };
export type GoogleElicitationRequest = {
  key: string;
  toolName: string;
  arguments: Record<string, unknown>;
  message: string;
  requestedSchema: Record<string, unknown>;
};
export type GoogleMcpTransportOptions = {
  authProvider?: NativeAuthProvider;
  fetch?: (input: string | URL, init?: RequestInit) => Promise<Response>;
  elicit?: (request: GoogleElicitationRequest, signal: AbortSignal) => Promise<GoogleElicitationResponse>;
  isCurrent?: () => boolean;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxInputRounds?: number;
};
/** Safe public errors deliberately contain no upstream body, header, token or request state. */
export class GoogleMcpTransportError extends Error {
  readonly code: string;
  readonly unknownOutcome: boolean;
  constructor(code: string, unknownOutcome = false) {
    super(code); this.name = 'GoogleMcpTransportError'; this.code = code; this.unknownOutcome = unknownOutcome;
  }
}
const PROTOCOL = '2026-07-28';
const MAX_ARGUMENT_BYTES = 4 * 1024 * 1024;
const MAX_WIRE_BYTES = 5 * 1024 * 1024;
const MAX_CONTROL_BYTES = 256 * 1024;
const CLIENT = Object.freeze({ name: 'OptraCall', version: '0.1.0' });
const META = Object.freeze({
  'io.modelcontextprotocol/protocolVersion': PROTOCOL,
  'io.modelcontextprotocol/clientInfo': CLIENT,
  'io.modelcontextprotocol/clientCapabilities': { elicitation: { form: {} } },
});
const nativeVersions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
function failure(code: string, unknown = false): never { throw new GoogleMcpTransportError(code, unknown); }
function jsonObject(value: unknown, maxBytes: number): Record<string, unknown> {
  if (!object(value)) return failure('gmail_protocol_invalid');
  let encoded: string;
  try { encoded = JSON.stringify(value); } catch { return failure('gmail_protocol_invalid'); }
  if (Buffer.byteLength(encoded) > maxBytes) return failure('gmail_payload_too_large');
  return JSON.parse(encoded) as Record<string, unknown>;
}
function boundedInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) return failure('gmail_transport_configuration_invalid');
  return value;
}
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(new GoogleMcpTransportError('gmail_call_cancelled')); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
function validFieldValue(field: Record<string, unknown>, item: unknown): boolean {
  if (field.type === 'string') return typeof item === 'string' && item.length <= 16384
    && !(typeof field.minLength === 'number' && item.length < field.minLength)
    && !(typeof field.maxLength === 'number' && item.length > field.maxLength)
    && !(Array.isArray(field.enum) && !field.enum.includes(item))
    && !(Array.isArray(field.oneOf) && !field.oneOf.some(option => object(option) && option.const === item));
  if (field.type === 'number' || field.type === 'integer') return typeof item === 'number' && Number.isFinite(item)
    && !(field.type === 'integer' && !Number.isInteger(item))
    && !(typeof field.minimum === 'number' && item < field.minimum)
    && !(typeof field.maximum === 'number' && item > field.maximum);
  if (field.type === 'boolean') return typeof item === 'boolean';
  return Array.isArray(item) && item.length <= 128 && new Set(item).size === item.length
    && item.every(entry => typeof entry === 'string' && (field.items as { enum: string[] }).enum.includes(entry))
    && !(typeof field.minItems === 'number' && item.length < field.minItems)
    && !(typeof field.maxItems === 'number' && item.length > field.maxItems);
}
function validateField(field: unknown): void {
  if (!object(field)) failure('gmail_form_unsupported');
  const type = field.type;
  if (!['string', 'number', 'integer', 'boolean', 'array'].includes(String(type))) failure('gmail_form_unsupported');
  const allowed = ['type', 'title', 'description', 'default', 'enum', 'enumNames', 'oneOf', 'minimum', 'maximum', 'minLength', 'maxLength', 'format', 'items', 'minItems', 'maxItems'];
  if (Object.keys(field).some(key => !allowed.includes(key))) failure('gmail_form_unsupported');
  for (const key of ['title', 'description'] as const) if (field[key] !== undefined && (typeof field[key] !== 'string' || field[key].length > 16000)) failure('gmail_form_unsupported');
  if (field.format !== undefined && !['email', 'uri', 'date', 'date-time'].includes(String(field.format))) failure('gmail_form_unsupported');
  if (field.enum !== undefined && (type !== 'string' || !Array.isArray(field.enum) || !field.enum.length || field.enum.length > 128 || field.enum.some(value => typeof value !== 'string' || value.length > 4000) || new Set(field.enum).size !== field.enum.length)) failure('gmail_form_unsupported');
  if (field.enumNames !== undefined && (!Array.isArray(field.enumNames) || !Array.isArray(field.enum) || field.enumNames.length !== field.enum.length || field.enumNames.some(value => typeof value !== 'string' || value.length > 4000))) failure('gmail_form_unsupported');
  if (field.oneOf !== undefined && (type !== 'string' || field.enum !== undefined || !Array.isArray(field.oneOf) || !field.oneOf.length || field.oneOf.length > 128 || field.oneOf.some(value => !object(value) || Object.keys(value).some(key => !['const', 'title'].includes(key)) || typeof value.const !== 'string' || value.const.length > 4000 || typeof value.title !== 'string' || value.title.length > 4000) || new Set(field.oneOf.map(value => (value as Record<string, unknown>).const)).size !== field.oneOf.length)) failure('gmail_form_unsupported');
  if (type === 'array') {
    if (!object(field.items) || field.items.type !== 'string' || !Array.isArray(field.items.enum) || !field.items.enum.length || field.items.enum.length > 128 || field.items.enum.some(value => typeof value !== 'string' || value.length > 4000) || new Set(field.items.enum).size !== field.items.enum.length || Object.keys(field.items).some(key => !['type', 'enum', 'enumNames'].includes(key))) failure('gmail_form_unsupported');
    if (field.items.enumNames !== undefined && (!Array.isArray(field.items.enumNames) || field.items.enumNames.length !== field.items.enum.length || field.items.enumNames.some(value => typeof value !== 'string'))) failure('gmail_form_unsupported');
  } else if (field.items !== undefined || field.minItems !== undefined || field.maxItems !== undefined) failure('gmail_form_unsupported');
  for (const key of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems'] as const) if (field[key] !== undefined && (typeof field[key] !== 'number' || !Number.isFinite(field[key]) || key !== 'minimum' && key !== 'maximum' && (!Number.isInteger(field[key]) || field[key] < 0 || field[key] > 16384))) failure('gmail_form_unsupported');
  if (type !== 'number' && type !== 'integer' && (field.minimum !== undefined || field.maximum !== undefined)
    || type !== 'string' && (field.minLength !== undefined || field.maxLength !== undefined || field.format !== undefined)
    || typeof field.minimum === 'number' && typeof field.maximum === 'number' && field.minimum > field.maximum
    || typeof field.minLength === 'number' && typeof field.maxLength === 'number' && field.minLength > field.maxLength
    || typeof field.minItems === 'number' && typeof field.maxItems === 'number' && field.minItems > field.maxItems
    || field.default !== undefined && !validFieldValue(field, field.default)) failure('gmail_form_unsupported');
}
export function validateServiceElicitationSchema(value: unknown): Record<string, unknown> {
  const schema = jsonObject(value, 64 * 1024);
  if (schema.type !== 'object' || !object(schema.properties) || Object.keys(schema.properties).length > 32 || Object.keys(schema).some(key => !['type', 'title', 'description', 'properties', 'required', 'additionalProperties'].includes(key)) || schema.additionalProperties !== undefined && schema.additionalProperties !== false) failure('gmail_form_unsupported');
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some(key => typeof key !== 'string' || !Object.hasOwn(schema.properties as object, key)) || new Set(schema.required).size !== schema.required.length)) failure('gmail_form_unsupported');
  for (const key of ['title', 'description'] as const) if (schema[key] !== undefined && (typeof schema[key] !== 'string' || schema[key].length > 16000)) failure('gmail_form_unsupported');
  for (const [key, field] of Object.entries(schema.properties)) {
    if (!key || key.length > 200 || ['__proto__', 'constructor', 'prototype'].includes(key)
      || /token|secret|password|credential|authorization|auth.?code|api.?key|private.?key/i.test(key)) failure('gmail_form_unsupported');
    validateField(field);
  }
  return schema;
}
export function validateServiceElicitationResponse(value: unknown, schema: Record<string, unknown>): GoogleElicitationResponse {
  if (!object(value) || !['accept', 'decline', 'cancel'].includes(String(value.action))) return failure('gmail_form_response_invalid');
  if (value.action !== 'accept') {
    if (Object.keys(value).some(key => key !== 'action')) return failure('gmail_form_response_invalid');
    return { action: value.action as 'decline' | 'cancel' };
  }
  if (Object.keys(value).some(key => !['action', 'content'].includes(key)) || !object(value.content)) return failure('gmail_form_response_invalid');
  const fields = schema.properties as Record<string, Record<string, unknown>>, content = value.content;
  if (Object.keys(content).some(key => !Object.hasOwn(fields, key)) || (schema.required as string[] | undefined)?.some(key => !Object.hasOwn(content, key))) return failure('gmail_form_response_invalid');
  for (const [key, item] of Object.entries(content)) {
    const field = fields[key]!;
    if (!validFieldValue(field, item)) return failure('gmail_form_response_invalid');
  }
  if (Buffer.byteLength(JSON.stringify(content)) > 64 * 1024) return failure('gmail_form_response_invalid');
  return { action: 'accept', content: structuredClone(content) as Record<string, string | number | boolean | string[]> };
}

/** Stateless 2026 Google protocol adapter at Pi's public transport seam. No call is replayed after a network or response failure. */
export function createGoogleMcpTransport(options: GoogleMcpTransportOptions = {}): NativeTransport {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const maxBytes = boundedInt(options.maxResponseBytes, 8 * 1024 * 1024, 1024, 16 * 1024 * 1024);
  const timeoutMs = boundedInt(options.timeoutMs, 120000, 1, 600000);
  const maxRounds = boundedInt(options.maxInputRounds, 8, 1, 16);
  const controller = new AbortController();
  const messages = new Set<Parameters<NativeTransport['onMessage']>[0]>();
  const errors = new Set<Parameters<NativeTransport['onError']>[0]>();
  const closes = new Set<Parameters<NativeTransport['onClose']>[0]>();
  let nextId = 0, closed = false;
  const check = (signal: AbortSignal) => { if (signal.aborted || closed) failure('gmail_call_cancelled'); if (options.isCurrent && !options.isCurrent()) failure('service_binding_changed'); };
  async function parseResponse(response: Response, expectedId: number, signal: AbortSignal): Promise<Record<string, unknown>> {
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (!['application/json', 'text/event-stream'].includes(contentType ?? '') || !response.body) failure('gmail_protocol_invalid');
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > maxBytes) { await response.body.cancel().catch(() => {}); failure('gmail_payload_too_large'); }
    const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0, buffer = '', data: string[] = [], eventCount = 0;
    const parse = (text: string): Record<string, unknown> | undefined => {
      let value: unknown;
      try { value = JSON.parse(text); } catch { return failure('gmail_protocol_invalid'); }
      if (!object(value) || value.jsonrpc !== '2.0') return failure('gmail_protocol_invalid');
      if (!Object.hasOwn(value, 'id')) {
        if (typeof value.method !== 'string' || Object.hasOwn(value, 'result') || Object.hasOwn(value, 'error')) return failure('gmail_protocol_invalid');
        return undefined; // Stateless progress notifications carry no call result.
      }
      if (value.id !== expectedId || Object.hasOwn(value, 'result') === Object.hasOwn(value, 'error')) return failure('gmail_protocol_invalid');
      if (Object.hasOwn(value, 'error') && (!object(value.error) || typeof value.error.code !== 'number' || typeof value.error.message !== 'string')) return failure('gmail_protocol_invalid');
      return value;
    };
    const event = (): Record<string, unknown> | undefined => {
      if (!data.length) return undefined;
      if (++eventCount > 128) failure('gmail_payload_too_large');
      const payload = data.join('\n'); data = [];
      return parse(payload);
    };
    const line = (text: string): Record<string, unknown> | undefined => {
      if (text === '') return event();
      if (text.startsWith(':')) return undefined;
      const colon = text.indexOf(':'), field = colon === -1 ? text : text.slice(0, colon);
      let value = colon === -1 ? '' : text.slice(colon + 1); if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') data.push(value);
      return undefined;
    };
    try {
      for (;;) {
        check(signal);
        const read = await raceAbort(reader.read(), signal);
        check(signal);
        if (read.done) {
          buffer += decoder.decode();
          if (contentType === 'application/json') return parse(buffer) ?? failure('gmail_response_missing');
          if (buffer) { const result = line(buffer); if (result) return result; }
          return event() ?? failure('gmail_response_missing');
        }
        bytes += read.value.byteLength;
        if (bytes > maxBytes) failure('gmail_payload_too_large');
        buffer += decoder.decode(read.value, { stream: true });
        if (contentType === 'text/event-stream') {
          let boundary: number;
          while ((boundary = buffer.search(/[\r\n]/)) !== -1) {
            if (buffer[boundary] === '\r' && boundary === buffer.length - 1) break;
            const width = buffer[boundary] === '\r' && buffer[boundary + 1] === '\n' ? 2 : 1;
            const result = line(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + width);
            if (result) return result;
          }
        }
      }
    } catch (error) {
      if (error instanceof GoogleMcpTransportError) throw error;
      return failure(signal.aborted ? 'gmail_call_cancelled' : 'gmail_response_lost');
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  async function wire(method: string, params: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    const id = ++nextId;
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    if (Buffer.byteLength(body) > MAX_WIRE_BYTES) failure('gmail_payload_too_large');
    for (let authAttempt = 0; authAttempt < 2; authAttempt++) {
      check(signal);
      const token = options.authProvider ? await raceAbort(options.authProvider.token(), signal) : undefined;
      check(signal);
      const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': PROTOCOL });
      if (token) headers.set('Authorization', `Bearer ${token}`);
      let response: Response;
      try { response = await raceAbort(fetchFn(SERVICE_URLS.gmail, { method: 'POST', headers, body, signal, redirect: 'error' }), signal); }
      catch { return failure(signal.aborted ? 'gmail_call_cancelled' : 'gmail_request_failed', method === 'tools/call'); }
      check(signal);
      const challenge = response.headers.get('www-authenticate') ?? '';
      if (response.status === 401 || response.status === 403 && /\binsufficient_scope\b/i.test(challenge)) {
        await response.body?.cancel().catch(() => {});
        if (authAttempt || !options.authProvider?.onUnauthorized) failure('service_authorization_required');
        try {
          await raceAbort(options.authProvider.onUnauthorized({ response: new Response(null, { status: response.status, headers: response.headers }), serverUrl: new URL(SERVICE_URLS.gmail), fetch: fetchFn, token }), signal);
        } catch { return failure(signal.aborted ? 'gmail_call_cancelled' : 'service_authorization_required'); }
        check(signal);
        continue; // Only an explicit authentication rejection permits this one retry.
      }
      if (!response.ok) { await response.body?.cancel().catch(() => {}); failure(response.status === 403 ? 'service_scope_missing' : 'gmail_http_failed', method === 'tools/call'); }
      try { return await parseResponse(response, id, signal); }
      catch (error) { if (error instanceof GoogleMcpTransportError) throw new GoogleMcpTransportError(error.code, method === 'tools/call'); throw error; }
    }
    return failure('service_authorization_required');
  }
  async function send(message: NativeMessage, sendOptions: NativeSendOptions = {}): Promise<void> {
    if ('method' in message && ['notifications/initialized', 'notifications/cancelled'].includes(message.method)) return;
    if (!('method' in message) || !('id' in message)) failure('gmail_method_unsupported');
    const timer = new AbortController(), timeout = setTimeout(() => timer.abort(), timeoutMs); timeout.unref();
    const signal = AbortSignal.any([controller.signal, timer.signal, ...(sendOptions.signal ? [sendOptions.signal] : [])]);
    let dispatched = false;
    try {
      check(signal);
      const original = message.params === undefined ? {} : jsonObject(message.params, message.method === 'tools/call' ? MAX_WIRE_BYTES : MAX_CONTROL_BYTES);
      let reply: Record<string, unknown>;
      if (message.method === 'initialize') {
        if (!nativeVersions.includes(String(original.protocolVersion))) failure('gmail_protocol_unsupported');
        dispatched = true; reply = await wire('server/discover', {}, signal);
        if (Object.hasOwn(reply, 'error')) {
          for (const listener of messages) listener({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'gmail_discovery_failed' } });
          return;
        }
        const discovered = reply.result;
        if (!object(discovered) || !Array.isArray(discovered.supportedVersions) || !discovered.supportedVersions.includes(PROTOCOL) || !object(discovered.capabilities) || !object(discovered._meta)) failure('gmail_protocol_unsupported');
        const serverInfo = discovered._meta['io.modelcontextprotocol/serverInfo'];
        if (!object(serverInfo) || typeof serverInfo.name !== 'string' || typeof serverInfo.version !== 'string') failure('gmail_protocol_invalid');
        reply = { result: { protocolVersion: original.protocolVersion, serverInfo, capabilities: discovered.capabilities, ...(typeof discovered.instructions === 'string' ? { instructions: discovered.instructions } : {}) } };
      } else {
        if (!['tools/list', 'tools/call', 'ping'].includes(message.method)) failure('gmail_method_unsupported');
        if (Object.hasOwn(original, 'requestState') || Object.hasOwn(original, 'inputResponses')) failure('gmail_protocol_invalid');
        if (message.method === 'tools/call') jsonObject(original.arguments ?? {}, MAX_ARGUMENT_BYTES);
        if (original._meta !== undefined) jsonObject(original._meta, MAX_CONTROL_BYTES);
        if (message.method === 'tools/call' && (typeof original.name !== 'string' || !original.name || !object(original.arguments ?? {}))) failure('gmail_protocol_invalid');
        const meta = { ...(object(original._meta) ? original._meta : {}), ...META };
        let params: Record<string, unknown> = { ...original, _meta: meta };
        let completed = false;
        for (let round = 0; round <= maxRounds; round++) {
          check(signal); dispatched = true; reply = await wire(message.method, params, signal);
          if (Object.hasOwn(reply, 'error')) { completed = true; break; }
          const result = reply.result;
          if (!object(result)) failure('gmail_protocol_invalid');
          if (result.resultType !== 'input_required') { completed = true; break; }
          if (message.method !== 'tools/call' || round === maxRounds || !options.elicit) failure('gmail_input_required_unsupported');
          if (typeof result.requestState !== 'string' || !result.requestState || result.requestState.length > 256 * 1024 || !object(result.inputRequests)) failure('gmail_protocol_invalid');
          const requests = Object.entries(result.inputRequests);
          if (!requests.length || requests.length > 16) failure('gmail_form_unsupported');
          const inputResponses: Record<string, GoogleElicitationResponse> = Object.create(null) as Record<string, GoogleElicitationResponse>;
          for (const [key, request] of requests) {
            if (!key || key.length > 200 || ['__proto__', 'constructor', 'prototype'].includes(key) || !object(request) || request.method !== 'elicitation/create' || !object(request.params) || request.params.mode !== 'form' || typeof request.params.message !== 'string' || request.params.message.length > 16000) failure('gmail_form_unsupported');
            const requestedSchema = validateServiceElicitationSchema(request.params.requestedSchema);
            const card: GoogleElicitationRequest = { key, toolName: String(original.name), arguments: structuredClone((original.arguments ?? {}) as Record<string, unknown>), message: request.params.message, requestedSchema: structuredClone(requestedSchema) };
            check(signal);
            const decision = await raceAbort(options.elicit(card, signal), signal);
            check(signal);
            inputResponses[key] = validateServiceElicitationResponse(decision, requestedSchema);
          }
          params = { ...original, _meta: meta, requestState: result.requestState, inputResponses };
        }
        if (!completed) failure('gmail_input_round_limit');
      }
      check(signal);
      if (Object.hasOwn(reply!, 'error')) {
        const upstream = reply!.error as Record<string, unknown>;
        for (const listener of messages) listener({ jsonrpc: '2.0', id: message.id, error: { code: Number(upstream.code), message: 'gmail_remote_error' } });
      } else for (const listener of messages) listener({ jsonrpc: '2.0', id: message.id, result: reply!.result });
    } catch (error) {
      const safe = error instanceof GoogleMcpTransportError ? error : new GoogleMcpTransportError(signal.aborted ? 'gmail_call_cancelled' : 'gmail_protocol_invalid', dispatched && message.method === 'tools/call');
      for (const listener of errors) listener(safe);
      throw safe;
    } finally { clearTimeout(timeout); }
  }
  return {
    async start() { if (closed) failure('gmail_transport_closed'); }, send,
    setProtocolVersion(version) { if (!nativeVersions.includes(version)) failure('gmail_protocol_unsupported'); },
    async close() { if (closed) return; closed = true; controller.abort(); for (const listener of closes) listener(); messages.clear(); errors.clear(); closes.clear(); },
    onMessage(listener) { messages.add(listener); return () => messages.delete(listener); },
    onError(listener) { errors.add(listener); return () => errors.delete(listener); },
    onClose(listener) { closes.add(listener); return () => closes.delete(listener); },
  };
}
