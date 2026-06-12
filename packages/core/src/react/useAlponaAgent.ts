import { useCallback, useRef, useState } from 'react';
import type { DashboardSpec, ParamValue, QueryResult } from '../types.js';
import type { GenerateRequest } from '../protocol.js';
import { readGenerationStream } from '../engine/sse.js';
import { applyPatch } from '../engine/patch.js';
import type { QueryFetcher } from '../engine/query-client.js';

export type AgentPhase = 'idle' | 'planning' | 'binding' | 'copy' | 'done' | 'error';

export interface AgentState {
  spec: DashboardSpec | null;
  /** widget id → insight description while binding is in flight. */
  pendingInsights: Record<string, string>;
  healedIds: Set<string>;
  phase: AgentPhase;
  statusMessage: string | null;
  error: string | null;
}

const INITIAL: AgentState = {
  spec: null,
  pendingInsights: {},
  healedIds: new Set(),
  phase: 'idle',
  statusMessage: null,
  error: null,
};

/**
 * Drives the generation pipeline over SSE and folds the event stream
 * into renderable state: the plan event paints the skeleton, widget
 * events hydrate slots as parallel binders finish, copy events fade in
 * captions, patch events morph the existing dashboard.
 */
export function useAlponaAgent(endpoint: string) {
  const [state, setState] = useState<AgentState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (request: GenerateRequest) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const isRefinement = request.spec !== undefined;
      setState((prev) => ({
        ...INITIAL,
        spec: isRefinement ? prev.spec : null,
        phase: 'planning',
        statusMessage: isRefinement ? 'Refining…' : 'Planning layout…',
      }));

      try {
        const response = await fetch(`${endpoint}/generate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
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
                return { ...prev, spec: { ...prev.spec, widgets }, pendingInsights, healedIds };
              }
              case 'patch': {
                if (!prev.spec) return prev;
                try {
                  return { ...prev, spec: applyPatch(prev.spec, event.operations) };
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
              case 'done':
                return { ...prev, spec: event.spec, phase: 'done', statusMessage: null };
              case 'error':
                return { ...prev, phase: 'error', error: event.message, statusMessage: null };
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
    [endpoint],
  );

  const generate = useCallback((prompt: string) => run({ prompt }), [run]);

  const refine = useCallback(
    (prompt: string, spec: DashboardSpec, targetWidgetId?: string) =>
      run({ prompt, spec, targetWidgetId }),
    [run],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState((prev) => ({ ...prev, phase: prev.spec ? 'done' : 'idle', statusMessage: null }));
  }, []);

  /** Replace the spec wholesale (e.g. loading a saved artifact). */
  const loadSpec = useCallback((spec: DashboardSpec) => {
    setState({ ...INITIAL, spec, phase: 'done' });
  }, []);

  /** Back to a clean slate (e.g. navigating to the landing page). */
  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL);
  }, []);

  return { ...state, generate, refine, cancel, loadSpec, reset };
}

/** Query fetcher hitting the Alpona query service. */
export function createHttpQueryFetcher(endpoint: string): QueryFetcher {
  return async (
    sql: string,
    params: Record<string, ParamValue>,
    signal: AbortSignal,
  ): Promise<QueryResult> => {
    const response = await fetch(`${endpoint}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
