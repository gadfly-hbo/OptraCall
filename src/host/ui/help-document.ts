import { manualMeta, manualSections, type HelpBlock } from './help-content.ts';

const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
function blockMarkdown(block: HelpBlock): string {
  switch (block.kind) {
    case 'text': return block.text;
    case 'steps': return block.items.map((item, index) => `${index + 1}. ${item}`).join('\n');
    case 'list': return block.items.map(item => `- ${item}`).join('\n');
    case 'prompt': return `### ${block.title}\n\n\`\`\`text\n${block.text}\n\`\`\``;
    case 'note': return `> **${block.title}**\n>\n${block.text.split('\n').map(line => `> ${line}`).join('\n')}`;
    case 'table': return [block.headers, block.headers.map(() => '---'), ...block.rows].map(row => `| ${row.map(cell).join(' | ')} |`).join('\n');
  }
}

/** The downloadable file and the product page use the same reviewed content. */
export function manualMarkdown(): string {
  return `# ${manualMeta.title}\n\n${manualMeta.description}\n\n更新日期：${manualMeta.updatedAt}\n\n` + manualSections.map(section => `## ${section.title}\n\n${section.summary}\n\n${section.blocks.map(blockMarkdown).join('\n\n')}`).join('\n\n') + '\n';
}
