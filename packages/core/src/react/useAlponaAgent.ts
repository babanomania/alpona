import { useCallback, useRef, useState } from 'react';
import type { DashboardSpec, ParamValue, QueryResult } from '../types.js';
import type { AnswerEvent, GenerateRequest } from '../protocol.js';
import { readGenerationStream } from '../engine/sse.js';
import { applyPatch } from '../engine/patch.js';
import type { QueryFetcher } from '../engine/query-client.js';

export type AgentPhase =
  | 'idle'
  | 'classifying'
  | 'planning'
  | 'binding'
  | 'copy'
  | 'answering'
  | 'done'
  | 'error';

export interface AgentLogEntry {
  at: number;
  kind: 'prompt' | 'answer' | 'patch' | 'heal' | 'error' | 'note';
  text: string;
  /** Full answer payload for answer cards in the conversation rail. */
  answer?: AnswerEvent;
  /** The question that produced an answer — titles a pinned widget. */
  question?: string;
  /** True when undo() can revert this entry's patch. */
  undoable?: boolean;
}

export interface AgentState {
  spec: DashboardSpec | null;
  /** widget id → insight description while binding is in flight. */
  pendingInsights: Record<string, string>;
  healedIds: Set<string>;
  phase: AgentPhase;
  statusMessage: string | null;
  error: string | null;
  /** Latest ask-mode answer (questions get answers, not dashboards). */
  answer: AnswerEvent | null;
  /** Session log feeding the conversation rail. Survives generations. */
  log: AgentLogEntry[];
}

const INITIAL: AgentState = {
  spec: null,
  pendingInsights: {},
  healedIds: new Set(),
  phase: 'idle',
  statusMessage: null,
  error: null,
  answer: null,
  log: [],
};

function entry(kind: AgentLogEntry['kind'], text: string, rest?: Partial<AgentLogEntry>) {
  return { at: Date.now(), kind, text, ...rest };
}

/**
 * Drives the generation pipeline over SSE and folds the event stream
 * into renderable state: the plan event paints the skeleton, widget
 * events hydrate slots as parallel binders finish, copy events fade in
 * captions, patch events morph the existing dashboard.
 */
/** Optional provider of extra request headers (e.g. an auth bearer). */
export type AuthHeaders = () => Record<string, string>;

export function useAlponaAgent(endpoint: string, authHeaders?: AuthHeaders) {
  const [state, setState] = useState<AgentState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);
  // Pre-edit spec snapshots for undo — a stack of dashboards the rail's
  // "undo" reverts to. Edits (refine, pin) push; undo pops.
  const undoStackRef = useRef<DashboardSpec[]>([]);

  const run = useCallback(
    async (request: GenerateRequest, label?: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const isEdit = request.spec !== undefined;
      // An edit snapshots the pre-edit spec so the resulting patch is
      // undoable; a fresh generation clears the redo history.
      if (isEdit && request.spec) undoStackRef.current.push(request.spec);
      else undoStackRef.current = [];

      setState((prev) => ({
        ...INITIAL,
        spec: isEdit ? prev.spec : null,
        // The session log is the conversation — it survives generations.
        log: [...prev.log, entry('prompt', label ?? request.prompt)],
        phase: 'planning',
        statusMessage: isEdit ? 'Refining…' : 'Planning layout…',
      }));

      try {
        const response = await fetch(`${endpoint}/generate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...authHeaders?.() },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`agent service responded ${response.status}`);
        }

        for await (const event of readGenerationStream(response.body, controller.signal)) {
          setState((prev) => {
            switch (event.type) {
              case 'status':
                return { ...prev, phase: event.phase, statusMessage: event.message };
              case 'plan':
                return {
                  ...prev,
                  spec: event.spec,
                  pendingInsights: event.pending,
                  phase: 'binding',
                };
              case 'widget': {
                if (!prev.spec) return prev;
                const widgets = prev.spec.widgets.map((w) =>
                  w.id === event.widget.id ? event.widget : w,
                );
                const pendingInsights = { ...prev.pendingInsights };
                delete pendingInsights[event.widget.id];
                const healedIds = event.healed
                  ? new Set(prev.healedIds).add(event.widget.id)
                  : prev.healedIds;
                const log = event.healed
                  ? [...prev.log, entry('heal', `${event.widget.id} self-healed`)]
                  : prev.log;
                return {
                  ...prev,
                  spec: { ...prev.spec, widgets },
                  pendingInsights,
                  healedIds,
                  log,
                };
              }
              case 'patch': {
                if (!prev.spec) return prev;
                try {
                  return {
                    ...prev,
                    spec: applyPatch(prev.spec, event.operations),
                    log: [
                      ...prev.log,
                      entry('patch', `${event.operations.length} change(s) applied`, {
                        undoable: undoStackRef.current.length > 0,
                      }),
                    ],
                  };
                } catch {
                  return prev; // a bad patch must never break the dashboard
                }
              }
              case 'copy': {
                if (!prev.spec) return prev;
                const widgets = prev.spec.widgets.map((w) =>
                  w.id === event.widgetId
                    ? { ...w, copy: { title: event.title, caption: event.caption } }
                    : w,
                );
                return { ...prev, spec: { ...prev.spec, widgets } };
              }
              case 'answer':
                // Ask mode is terminal: an answer card, not a dashboard.
                return {
                  ...prev,
                  answer: event,
                  phase: 'done',
                  statusMessage: null,
                  log: [
                    ...prev.log,
                    entry('answer', event.answer, { answer: event, question: request.prompt }),
                  ],
                };
              case 'done':
                return { ...prev, spec: event.spec, phase: 'done', statusMessage: null };
              case 'error':
                return {
                  ...prev,
                  phase: 'error',
                  error: event.message,
                  statusMessage: null,
                  log: [...prev.log, entry('error', event.message)],
                };
            }
          });
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setState((prev) => ({
          ...prev,
          phase: 'error',
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    },
    [endpoint, authHeaders],
  );

  const generate = useCallback((prompt: string) => run({ prompt }), [run]);

  const refine = useCallback(
    (prompt: string, spec: DashboardSpec, targetWidgetId?: string) =>
      run({ prompt, spec, targetWidgetId }),
    [run],
  );

  /** Pin an ask-mode answer onto the current dashboard as a widget. */
  const pin = useCallback(
    (spec: DashboardSpec, pinAnswer: NonNullable<GenerateRequest['pinAnswer']>) =>
      run({ prompt: 'pin answer', spec, pinAnswer }, `pinned “${pinAnswer.title}”`),
    [run],
  );

  /**
   * Remove a widget from the dashboard. Pure-code spec surgery — the
   * composer frees the slot on re-interpret — so it never calls the model.
   * Undoable, like any edit.
   */
  const removeWidget = useCallback((widgetId: string) => {
    setState((prev) => {
      if (!prev.spec) return prev;
      const widget = prev.spec.widgets.find((w) => w.id === widgetId);
      if (!widget) return prev;
      undoStackRef.current.push(prev.spec);
      const widgets = prev.spec.widgets.filter((w) => w.id !== widgetId);
      const label = widget.copy.title ?? widgetId;
      return {
        ...prev,
        spec: { ...prev.spec, widgets },
        log: [...prev.log, entry('patch', `removed “${label}”`, { undoable: true })],
      };
    });
  }, []);

  /** Revert the last undoable edit, restoring the pre-edit spec. */
  const undo = useCallback(() => {
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    setState((prev) => ({
      ...prev,
      spec: previous,
      phase: 'done',
      log: [...prev.log, entry('note', 'reverted the last change')],
    }));
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState((prev) => ({ ...prev, phase: prev.spec ? 'done' : 'idle', statusMessage: null }));
  }, []);

  /** Replace the spec wholesale (e.g. loading a saved artifact). */
  const loadSpec = useCallback((spec: DashboardSpec) => {
    undoStackRef.current = [];
    setState({ ...INITIAL, spec, phase: 'done' });
  }, []);

  /** Back to a clean slate (e.g. navigating to the landing page). */
  const reset = useCallback(() => {
    abortRef.current?.abort();
    undoStackRef.current = [];
    setState(INITIAL);
  }, []);

  const canUndo = undoStackRef.current.length > 0;
  return { ...state, generate, refine, pin, removeWidget, undo, canUndo, cancel, loadSpec, reset };
}

/** Query fetcher hitting the Alpona query service. */
export function createHttpQueryFetcher(endpoint: string, authHeaders?: AuthHeaders): QueryFetcher {
  return async (
    sql: string,
    params: Record<string, ParamValue>,
    signal: AbortSignal,
  ): Promise<QueryResult> => {
    const response = await fetch(`${endpoint}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders?.() },
      body: JSON.stringify({ sql, params }),
      signal,
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `query service responded ${response.status}`);
    }
    return (await response.json()) as QueryResult;
  };
}
