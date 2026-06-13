import { useState } from 'react';
import type { AgentLogEntry } from '@alpona/core/react';
import {
  AlertTriangle,
  ChevronDown,
  CornerDownRight,
  Database,
  GitBranch,
  MessageSquare,
  Pin,
  RotateCcw,
  Sparkles,
  Wrench,
} from 'lucide-react';

/**
 * The conversation rail (PLAN.md §5.17): the session as a log. User
 * prompts, answer cards (headline value, the one-line answer, a
 * collapsible "ran this query" disclosure, Pin as widget), patch
 * summaries with undo, self-heal notices.
 */

function AnswerCard({
  entry,
  canPin,
  onPin,
  onFollowUp,
}: {
  entry: AgentLogEntry;
  canPin: boolean;
  onPin: () => void;
  onFollowUp: () => void;
}) {
  const [open, setOpen] = useState(false);
  const answer = entry.answer;
  if (!answer) return null;
  const rowCount = answer.rows.length;

  return (
    <div className="rail__card">
      {answer.value !== undefined && answer.value !== null && (
        <div className="rail__value">{String(answer.value)}</div>
      )}
      <p className="rail__answer">{answer.answer}</p>
      <button className="rail__sql-toggle" onClick={() => setOpen((o) => !o)}>
        <Database size={12} />
        ran this query
        {answer.elapsedMs !== undefined ? ` · ${(answer.elapsedMs / 1000).toFixed(1)}s` : ''}
        {` · ${rowCount} row${rowCount === 1 ? '' : 's'}`}
        <ChevronDown size={12} className={open ? 'rail__chev rail__chev--open' : 'rail__chev'} />
      </button>
      {open && <pre className="rail__sql">{answer.sql}</pre>}
      <div className="rail__card-actions">
        <button className="btn btn--ghost btn--xs" onClick={onFollowUp}>
          <CornerDownRight size={13} /> Ask follow-up
        </button>
        {canPin && (
          <button className="btn btn--primary btn--xs" onClick={onPin}>
            <Pin size={13} /> Pin as widget
          </button>
        )}
      </div>
    </div>
  );
}

const ICONS: Record<AgentLogEntry['kind'], typeof Sparkles> = {
  prompt: MessageSquare,
  answer: Sparkles,
  patch: GitBranch,
  heal: Wrench,
  error: AlertTriangle,
  note: RotateCcw,
};

export function ConversationRail({
  log,
  canPin,
  onPin,
  onUndo,
  onFollowUp,
}: {
  log: AgentLogEntry[];
  canPin: boolean;
  onPin: (entry: AgentLogEntry) => void;
  onUndo: () => void;
  onFollowUp: () => void;
}) {
  if (log.length === 0) {
    return (
      <div className="rail rail--empty">
        <MessageSquare size={18} />
        <p>Your questions and edits appear here.</p>
        <span>Ask for a number, or describe a view — Alpona decides which.</span>
      </div>
    );
  }

  return (
    <div className="rail">
      {log.map((item, i) => {
        const Icon = ICONS[item.kind];
        if (item.kind === 'answer') {
          return (
            <div key={i} className="rail__entry rail__entry--answer">
              <span className="rail__icon">
                <Icon size={13} />
              </span>
              <AnswerCard
                entry={item}
                canPin={canPin}
                onPin={() => onPin(item)}
                onFollowUp={onFollowUp}
              />
            </div>
          );
        }
        return (
          <div key={i} className={`rail__entry rail__entry--${item.kind}`}>
            <span className="rail__icon">
              <Icon size={13} />
            </span>
            <div className="rail__line">
              <span>{item.text}</span>
              {item.undoable && (
                <button className="rail__undo" onClick={onUndo}>
                  <RotateCcw size={11} /> undo
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
