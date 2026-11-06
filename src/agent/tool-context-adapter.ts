import type { Extension, ExtensionToolContext, LoadExtensionsResult, RegisteredCommand, RegisteredTool, ToolDefinition } from './sdk.ts';

/** Own descriptors. No field allowlist or SDK registration writes. */
function ownCopy<T extends object>(source: T, replacements: PropertyDescriptorMap = {}): T {
  return Object.create(Object.getPrototypeOf(source), { ...Object.getOwnPropertyDescriptors(source), ...replacements });
}

/** The original registration Map remains the SDK's sole authority. Pi 1.4.0
 * consumes its read surface; unsupported writes fail rather than mutate it. */
class RegistrationView<K, V> extends Map<K, V> {
  #source: Map<K, V>;
  #project: (value: V) => V;
  constructor(source: Map<K, V>, project: (value: V) => V) { super(); this.#source = source; this.#project = project; }
  override get size() { return this.#source.size; }
  override has(key: K) { return this.#source.has(key); }
  override get(key: K) { const value = this.#source.get(key); return value === undefined ? undefined : this.#project(value); }
  override keys() { return this.#source.keys(); }
  override *values(): MapIterator<V> { for (const value of this.#source.values()) yield this.#project(value); }
  override *entries(): MapIterator<[K, V]> { for (const [key, value] of this.#source.entries()) yield [key, this.#project(value)]; }
  override [Symbol.iterator]() { return this.entries(); }
  override forEach(callback: (value: V, key: K, map: Map<K, V>) => void, thisArg?: unknown) {
    for (const [key, value] of this.entries()) callback.call(thisArg, value, key, this);
  }
  override set(_key: K, _value: V): this { throw new Error('sdk_registration_view_write_unsupported'); }
  override delete(_key: K): boolean { throw new Error('sdk_registration_view_write_unsupported'); }
  override clear(): void { throw new Error('sdk_registration_view_write_unsupported'); }
}

/** Bind to one real invocation using the existing owner/run/session lifecycle.
 * This supplies no registry, scheduling, analysis steps or persistent state. */
export function createToolContextAdapter(qualify: (ctx: ExtensionToolContext, signal: AbortSignal | undefined) => () => boolean) {
  function tool<T extends ToolDefinition<any, any, any>>(original: T): T {
    // These three hooks are invoked as definition methods by SDK 1.4.0.
    // Callbacks that Pi forwards (prepareArguments/reachesTools etc.) stay raw.
    const methods = new WeakMap<Function, Function>();
    const member = (callback: unknown) => {
      if (typeof callback !== 'function') return callback;
      let bound = methods.get(callback);
      if (!bound) { bound = callback.bind(original); methods.set(callback, bound!); }
      return bound;
    };
    const execute: T['execute'] = async (toolCallId, parameters, signal, update, ctx) => {
      if (!ctx) return original.execute.call(original, toolCallId, parameters, signal, update, ctx);
      const isCurrent = qualify(ctx, signal);
      let active = true;
      const available = () => active && isCurrent();
      const denied = (name: string, args: unknown) => ({
        toolCall: { type: 'toolCall' as const, id: `${toolCallId}/0`, name, arguments: args as Record<string, unknown> },
        result: { content: [{ type: 'text' as const, text: 'personal_context_run_unavailable' }], details: {} }, isError: true,
      });
      // Do not inherit from ctx: that would expose its unqualified delegate.
      const scoped: ExtensionToolContext = Object.create(Object.getPrototypeOf(ctx), {
        ...Object.getOwnPropertyDescriptors(ctx),
        executeTool: { value: async (name: string, args: unknown, options?: Parameters<ExtensionToolContext['executeTool']>[2]) => {
          if (!available()) return denied(name, args);
          const result = await ctx.executeTool(name, args, options);
          return available() ? result : denied(name, args);
        } },
      });
      try { return await original.execute.call(original, toolCallId, parameters, signal, update, scoped); }
      finally { active = false; }
    };
    const descriptor = Object.getOwnPropertyDescriptor(original, 'execute');
    const replacements: PropertyDescriptorMap = { execute: { value: execute, enumerable: descriptor?.enumerable ?? true,
      configurable: descriptor?.configurable ?? true, writable: descriptor && 'writable' in descriptor ? descriptor.writable : true } };
    for (const name of ['prepareLoadout', 'renderCall', 'renderResult'] as const) {
      if (typeof original[name] !== 'function') continue;
      const descriptor = Object.getOwnPropertyDescriptor(original, name);
      replacements[name] = { value: member(original[name]),
        enumerable: descriptor?.enumerable ?? true, configurable: descriptor?.configurable ?? true,
        writable: descriptor && 'writable' in descriptor ? descriptor.writable : true };
    }
    const owned = ownCopy(original, replacements);
    // Proxy only our own object. Metadata accessors (including prototype/private
    // getters) keep their original receiver; raw callbacks keep SDK semantics.
    return new Proxy(owned, { get(target, key) {
      if (key === 'execute') return Reflect.get(target, key, target);
      const value = Reflect.get(original, key, original);
      return key === 'prepareLoadout' || key === 'renderCall' || key === 'renderResult' ? member(value) : value;
    } });
  }

  function extension(original: Extension): Extension {
    let owned: Extension;
    const tools = new WeakMap<RegisteredTool, RegisteredTool>(), commands = new WeakMap<RegisteredCommand, RegisteredCommand>();
    const projectTool = (registered: RegisteredTool) => {
      let copy = tools.get(registered);
      if (!copy) {
        copy = ownCopy(registered, { definition: { value: tool(registered.definition), enumerable: true, writable: true, configurable: true },
          sourceInfo: { value: undefined, enumerable: true, writable: true, configurable: true } });
        tools.set(registered, copy);
      }
      // Late registerTool closes over the original Extension's synthetic source.
      // The resolved owning Extension, not that stale record, defines provenance.
      copy.sourceInfo = owned.sourceInfo;
      return copy;
    };
    const projectCommand = (registered: RegisteredCommand) => {
      let copy = commands.get(registered);
      if (!copy) {
        copy = ownCopy(registered, { sourceInfo: { value: undefined, enumerable: true, writable: true, configurable: true } });
        commands.set(registered, copy);
      }
      copy.sourceInfo = owned.sourceInfo;
      return copy;
    };
    owned = ownCopy(original, {
      tools: { value: new RegistrationView(original.tools, projectTool), enumerable: true, writable: true, configurable: true },
      commands: { value: new RegistrationView(original.commands, projectCommand), enumerable: true, writable: true, configurable: true },
      sourceInfo: { value: original.sourceInfo, enumerable: true, writable: true, configurable: true },
    });
    return owned;
  }

  return {
    tool,
    extensionsOverride: (base: LoadExtensionsResult): LoadExtensionsResult => ({ ...base, extensions: base.extensions.map(extension) }),
  };
}
