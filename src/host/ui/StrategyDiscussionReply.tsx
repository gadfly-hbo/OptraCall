import { StrategyAttachmentEvidence } from './StrategyAttachmentEvidence.tsx';
import type { StrategyAttachmentReplyReferences } from '../strategy-attachment-types.ts';
import { messageText, type NativeMessage } from './project-types.ts';
import { Marked } from 'marked';
import type { MarkedToken, Token, Tokens } from 'marked';
import markedCjkFriendly from 'marked-cjk-friendly';
import { Fragment, memo } from 'react';
import type { ReactNode } from 'react';

const replyHeadings = ['h3', 'h3', 'h4', 'h5', 'h6', 'h6'] as const;
const markdown = new Marked({ gfm: true, breaks: true }, markedCjkFriendly());

function renderTokens(tokens: Token[]): ReactNode {
  return tokens.map((token, index) => <Fragment key={index}>{renderToken(token as MarkedToken)}</Fragment>);
}

function renderTable(table: Tokens.Table) {
  return <div className="sg-table-scroll" role="region" aria-label="回复表格" tabIndex={0}>
    <table className="sg-table">
      <thead><tr>{table.header.map((cell, index) => <th key={index} scope="col" style={cell.align ? { textAlign: cell.align } : undefined}>{renderTokens(cell.tokens)}</th>)}</tr></thead>
      <tbody>{table.rows.map((row, index) => <tr key={index}>
        {row.map((cell, column) => <td key={column} style={cell.align ? { textAlign: cell.align } : undefined}>{renderTokens(cell.tokens)}</td>)}
      </tr>)}</tbody>
    </table>
  </div>;
}

function renderLink(link: Tokens.Link): ReactNode {
  const label = renderTokens(link.tokens);
  if (!/^https?:\/\//i.test(link.href)) return label;
  try {
    const url = new URL(link.href);
    if (url.username || url.password) return label;
    return <a href={url.href} title={link.title ?? undefined} target="_blank" rel="noopener noreferrer">{label}</a>;
  } catch {
    return label;
  }
}

function renderToken(token: MarkedToken): ReactNode {
  const { raw } = token;
  // Use Marked's lexer only. React owns all elements and escapes message text.
  switch (token.type) {
    case 'heading': {
      const Heading = replyHeadings[token.depth - 1] ?? 'h6';
      return <Heading>{renderTokens(token.tokens)}</Heading>;
    }
    case 'paragraph': return <p>{renderTokens(token.tokens)}</p>;
    case 'strong': return <strong>{renderTokens(token.tokens)}</strong>;
    case 'em': return <em>{renderTokens(token.tokens)}</em>;
    case 'del': return <del>{renderTokens(token.tokens)}</del>;
    case 'blockquote': return <blockquote>{renderTokens(token.tokens)}</blockquote>;
    case 'list': {
      const items = renderTokens(token.items);
      return token.ordered ? <ol start={typeof token.start === 'number' ? token.start : undefined}>{items}</ol> : <ul>{items}</ul>;
    }
    case 'list_item': return <li>{renderTokens(token.tokens)}</li>;
    case 'table': return renderTable(token);
    case 'code': return <pre><code>{token.text}</code></pre>;
    case 'codespan': return <code>{token.text}</code>;
    case 'hr': return <hr />;
    case 'br': return <br />;
    case 'link': return renderLink(token);
    case 'image': return token.text || raw;
    case 'html': return token.block ? <p className="strategy-discussion-literal">{raw}</p> : raw;
    case 'text': return token.tokens ? renderTokens(token.tokens) : token.text;
    case 'escape': return token.text;
    case 'space':
    case 'def': return null;
    default: return raw;
  }
}

export const StrategyDiscussionReply = memo(function StrategyDiscussionReply({ text }: { text: string }) {
  try {
    return <div className="strategy-discussion-reply">{renderTokens(markdown.lexer(text))}</div>;
  } catch {
    return <p>{text}</p>;
  }
});

export function StrategyDiscussionTranscript({ messages, streaming, discussionId,references,label = '战略讨论记录' }: { messages: NativeMessage[]; streaming?: string; discussionId?:string; references?:StrategyAttachmentReplyReferences[]; label?: string }) {
  return <div className="strategy-discussion-messages" role="log" aria-label={label}>
    {messages.map((message, index) => {
      const cited=references?.find(ref=>ref.entryId===message.nativeEntryId)?.citations??[];
      const text=cited.reduce((s,c)=>s.replaceAll('[[资料:'+c.token+']]','〔'+c.locator+'〕'),messageText(message));
      return <article className={`strategy-discussion-message ${message.role}`} key={message.nativeEntryId || index}>
      <strong>{message.role === 'user' ? '你' : 'Agent'}</strong>
      {message.role === 'assistant' ? <StrategyDiscussionReply text={text} /> : <p>{messageText(message)}</p>}
      {discussionId&&cited.length>0&&<div className="sg-row" aria-label="本回复引用的资料">{cited.map(c=><StrategyAttachmentEvidence key={c.token} discussionId={discussionId} citation={c}/>)}</div>}
    </article>;})}
    {streaming && <article className="strategy-discussion-message assistant"><strong>Agent</strong><StrategyDiscussionReply text={streaming} /></article>}
  </div>;
}
