type ObjectBranch = { properties: Record<string, unknown>; required: string[] };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

function objectBranches(value: unknown): ObjectBranch[] | undefined {
  if (!object(value)) return;
  if (Array.isArray(value.anyOf)) {
    const branches: ObjectBranch[] = [];
    for (const item of value.anyOf) {
      const nested = objectBranches(item); if (!nested) return;
      branches.push(...nested);
    }
    return branches.length ? branches : undefined;
  }
  if (value.type !== 'object' || !object(value.properties)) return;
  if (value.required !== undefined && (!Array.isArray(value.required) || value.required.some(name => typeof name !== 'string'))) return;
  return [{ properties: value.properties, required: (value.required ?? []) as string[] }];
}

/** Provider serialization metadata only; registered TypeBox parameters stay original. */
export function semanticContextAnthropicPayload(payload: unknown, parameters: unknown): unknown | undefined {
  if (!object(payload) || !Array.isArray(payload.tools) || !object(parameters) || !Array.isArray(parameters.anyOf)) return;
  const tool = payload.tools.find(item => object(item) && item.name === 'read_semantic_context');
  if (!object(tool) || !object(tool.input_schema) || tool.strict === true) return;
  const branches = objectBranches(parameters); if (!branches) return;
  const names = [...new Set(branches.flatMap(branch => Object.keys(branch.properties)))];
  const properties = Object.fromEntries(names.map(name => {
    const variants = [...new Map(branches.filter(branch => name in branch.properties).map(branch => [JSON.stringify(branch.properties[name]), branch.properties[name]])).values()];
    return [name, variants.length === 1 ? variants[0] : { anyOf: variants }];
  }));
  const required = branches[0]!.required.filter(name => branches.every(branch => branch.required.includes(name)));
  // The SDK payload hook shares references with earlier handlers. Return fresh
  // wire-only objects, including nested schema metadata; never edit parameters.
  const input_schema = JSON.parse(JSON.stringify({ ...tool.input_schema, type: 'object', properties, required })) as unknown;
  return { ...payload, tools: payload.tools.map(item => item === tool ? { ...tool, input_schema } : item) };
}
