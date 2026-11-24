/** The same field paths describe an incoming draft or an older stored draft in the workbench. */
export function decisionChoiceIssue(value: unknown): {path: string; reason: string} | undefined {
  const root = 'payload.decisionChoices';
  if (!Array.isArray(value)) return {path: root, reason: 'expected_array'};
  const ids = new Set<string>();
  for (const [index, choice] of value.entries()) {
    const path = `${root}[${index}]`;
    if (!choice || typeof choice !== 'object' || Array.isArray(choice)) return {path, reason: 'expected_object'};
    for (const key of ['id', 'question'] as const) {
      if (typeof choice[key] !== 'string' || !choice[key].trim()) return {path: `${path}.${key}`, reason: 'expected_non_empty_string'};
    }
    if (ids.has(choice.id)) return {path: `${path}.id`, reason: 'duplicate_id'};
    ids.add(choice.id);
    if (!Array.isArray(choice.options)) return {path: `${path}.options`, reason: 'expected_array'};
    const keys = new Set<string>();
    for (const [i, option] of choice.options.entries()) {
      const optionPath = `${path}.options[${i}]`;
      if (!option || typeof option !== 'object' || Array.isArray(option)) return {path: optionPath, reason: 'expected_object'};
      for (const key of ['key', 'label'] as const) {
        if (typeof option[key] !== 'string' || !option[key].trim()) return {path: `${optionPath}.${key}`, reason: 'expected_non_empty_string'};
      }
      if (option.key !== option.key.trim()) return {path: `${optionPath}.key`, reason: 'unexpected_outer_whitespace'};
      if (typeof option.impact !== 'string') return {path: `${optionPath}.impact`, reason: 'expected_string'};
      if (keys.has(option.key)) return {path: `${optionPath}.key`, reason: 'duplicate_key'};
      keys.add(option.key);
    }
    for (const key of ['selectedKey', 'decidedBy', 'decidedAt', 'inheritedFromVersion'] as const) {
      if (choice[key] !== undefined && typeof choice[key] !== 'string') return {path: `${path}.${key}`, reason: 'expected_string'};
    }
  }
}
