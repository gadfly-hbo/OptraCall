import type { ServiceConnectionCallContext } from '../agent/service-connection-tools.ts';
import type { GoogleElicitationRequest, GoogleElicitationResponse } from './service-connection-google-transport.ts';
import { validateServiceElicitationSchema, validateServiceElicitationResponse } from './service-connection-google-transport.ts';
import { ServiceConnectionError, serviceRecord } from './service-connection-types.ts';

function canonical(value: unknown): string {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort) : serviceRecord(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, sort(item[key])])) : item;
  return JSON.stringify(sort(value));
}
/** Form answers belong to the original unchanged invocation, never a later Agent turn. */
export async function answerServiceForm(request: GoogleElicitationRequest, context: ServiceConnectionCallContext, approved?: { toolName: string; args: Record<string, unknown> }): Promise<GoogleElicitationResponse> {
  context.signal.throwIfAborted(); context.assertCurrent();
  const schema = validateServiceElicitationSchema(request.requestedSchema);
  if (!serviceRecord(request.requestedSchema.properties)) throw new ServiceConnectionError('service_form_unsupported', 409);
  const fields = Object.entries(request.requestedSchema.properties);
  if (fields.length > 32 || fields.some(([key, value]) => /password|secret|token|authorization.?code/i.test(key) || !serviceRecord(value))) throw new ServiceConnectionError('service_form_unsupported', 409);
  const required = request.requestedSchema.required ?? [];
  if (!Array.isArray(required)) throw new ServiceConnectionError('service_form_unsupported', 409);
  const sameApproval = approved?.toolName === request.toolName && canonical(approved.args) === canonical(request.arguments);
  const content: Record<string, string | number | boolean | string[]> = {};
  for (const [key, raw] of fields) {
    const field = raw as Record<string, unknown>;
    context.signal.throwIfAborted(); context.assertCurrent();
    const title = `${typeof field.title === 'string' ? field.title : key}${typeof field.description === 'string' ? `\n${field.description}` : ''}`;
    const options = Array.isArray(field.enum) ? field.enum : Array.isArray(field.oneOf) ? field.oneOf.map(item => serviceRecord(item) ? item.const : undefined) : undefined;
    if (options) {
      if (options.some(item => typeof item !== 'string') || options.length > 128 || !options.length) throw new ServiceConnectionError('service_form_unsupported', 409);
      const values = options as string[];
      // Reuse only the exact prior content confirmation and Google's explicit once-only consent form.
      if (sameApproval && values.length === 2 && values.includes('ALLOW_ONCE') && values.includes('DENY_ONCE')) content[key] = 'ALLOW_ONCE';
      else {
        const choices = values.map((value, index) => `${Array.isArray(field.enumNames) && typeof field.enumNames[index] === 'string' ? field.enumNames[index] : Array.isArray(field.oneOf) && serviceRecord(field.oneOf[index]) && typeof field.oneOf[index].title === 'string' ? field.oneOf[index].title : value} [${index + 1}]`);
        const selected = await context.select(`${request.message}\n${title}`, choices), index = choices.indexOf(selected);
        if (index < 0) return { action: 'cancel' };
        content[key] = values[index]!;
      }
    } else if (field.type === 'boolean') content[key] = await context.confirm(title, request.message);
    else if (field.type === 'string' || field.type === 'number' || field.type === 'integer') {
      const answer = await context.input(`${request.message}\n${title}`, required.includes(key) ? undefined : '可留空');
      context.signal.throwIfAborted(); context.assertCurrent();
      if (!answer && !required.includes(key)) continue;
      if (field.type === 'string') content[key] = answer;
      else { const number = Number(answer); if (!answer.trim() || !Number.isFinite(number) || field.type === 'integer' && !Number.isInteger(number)) throw new ServiceConnectionError('service_form_response_invalid'); content[key] = number; }
    } else if (field.type === 'array' && serviceRecord(field.items) && Array.isArray(field.items.enum) && field.items.enum.every(item => typeof item === 'string')) {
      const choices = field.items.enum as string[], selected: string[] = [];
      if (choices.length > 128) throw new ServiceConnectionError('service_form_unsupported', 409);
      for (let i = 0; i <= choices.length; i++) {
        const remaining = choices.filter(item => !selected.includes(item));
        const values = ['完成选择', ...remaining.map((item, index) => `${item} [${index + 1}]`)];
        const choice = await context.select(`${request.message}\n${title}\n已选：${selected.join('、')}`, values);
        if (choice === values[0]) break;
        const index = values.indexOf(choice) - 1;
        if (index < 0) return { action: 'cancel' };
        selected.push(remaining[index]!);
      }
      content[key] = selected;
    } else throw new ServiceConnectionError('service_form_unsupported', 409);
    context.signal.throwIfAborted(); context.assertCurrent();
  }
  context.signal.throwIfAborted(); context.assertCurrent();
  return validateServiceElicitationResponse({ action: 'accept', content }, schema);
}
