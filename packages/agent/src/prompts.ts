import type { DataDictionary, DashboardSpec } from '@alpona/core';
import { dictionaryToPrompt, layoutTemplates, widgetDefinitions } from '@alpona/core';
import type { BinderRequest, CopyRequest } from './stages.js';

/**
 * Prompt builders. Grounding rule: everything the model is told about the
 * domain comes from the data dictionary; everything about presentation
 * comes from the layout library and widget registry. No domain knowledge
 * is ever hardcoded here.
 */

function layoutLibraryForPrompt(): string {
  return layoutTemplates
    .map((t) => {
      const slots = t.slots
        .map(
          (s) =>
            `  - ${s.id} (${s.role}): ${s.description} accepts=[${s.accepts.join(', ') || 'any'}] count=${s.minWidgets}-${s.maxWidgets}`,
        )
        .join('\n');
      return `${t.name}@${t.version} — ${t.whenToUse}\n${slots}`;
    })
    .join('\n\n');
}

function widgetContractsForPrompt(types?: string[]): string {
  return widgetDefinitions
    .filter((d) => !types || types.includes(d.type))
    .map((d) => {
      const shape = [
        ...d.resultShape.required.map((k) => `${k} (required): ${d.resultShape.docs[k] ?? ''}`),
        ...d.resultShape.optional.map((k) => `${k} (optional): ${d.resultShape.docs[k] ?? ''}`),
      ].join('; ');
      return `${d.type} — ${d.agentHints.whenToUse}\n  resultShape: ${shape || 'none'}\n  sql: ${d.agentHints.sqlGuidance}`;
    })
    .join('\n\n');
}

const JSON_ONLY =
  'Respond with a single JSON object and nothing else — no prose, no markdown fences.';

export function plannerSystemPrompt(dictionary: DataDictionary): string {
  return `You are the Planner in Alpona, a generative dashboard engine. Given a user's request, you decide WHAT to show: pick one layout template, then assign one insight per slot position. You do not write SQL — binders do that downstream.

LAYOUT LIBRARY (pick exactly one, reference as "name@version"):

${layoutLibraryForPrompt()}

WIDGET TYPES:

${widgetContractsForPrompt()}

DATA AVAILABLE (the only tables that exist — never invent columns):

${dictionaryToPrompt(dictionary)}

Rules:
- Respect each slot's accepted widget types and min/max counts.
- Widget ids: short kebab-case, unique, descriptive (e.g. "delay-trend").
- "insight" is one sentence (under 180 characters) describing what the widget must show — a binder will turn it into SQL, so name the concrete tables/columns involved.
- Declare params for anything the user will want to re-run with different values (date ranges as ISO dates, entity filters). Reference them later via {{params.name}}.
- Prefer analytical views (marts) over raw tables.

${JSON_ONLY}
Output: {"title": string, "layout": "name@version", "params": {name: defaultValue}, "widgets": [{"id", "slot", "type", "insight"}]}`;
}

export function binderSystemPrompt(dictionary: DataDictionary, dialect: string): string {
  return `You are a Binder in Alpona, a generative dashboard engine. You receive ONE planned widget and write the SQL that powers it, plus the resultShape mapping result columns onto the widget's visual roles.

DATA AVAILABLE (the only tables that exist — never invent columns):

${dictionaryToPrompt(dictionary)}

WIDGET CONTRACTS:

${widgetContractsForPrompt()}

Rules:
- ${dialect} dialect. One SELECT statement only. CTEs and window functions are fine.
- Reference dashboard params as {{params.name}} — they are bound server-side as parameters. Only the params declared in the request exist; never invent new ones. If none are declared, inline literal values instead. When comparing a date param, cast explicitly: column >= CAST({{params.from}} AS DATE).
- Aggregate in SQL; widgets render what they receive. Alias columns to short readable snake_case names and map them in resultShape.
- resultShape keys are the widget contract's role names EXACTLY (value, label, x, y, series, …); each value is the SQL column alias that fills the role — {"value": "late_count"}, never the column name as the key.
- Keep result sets small: aggregate, ORDER BY the interesting measure, LIMIT sensibly.
- "title" is a short human title for the widget (max 8 words).

${JSON_ONLY}
Output: {"sql": string, "resultShape": {role: column}, "props": {…}?, "title": string}`;
}

export function binderUserPrompt(request: BinderRequest): string {
  const { widget, plan, userPrompt, feedback } = request;
  const params = Object.entries(plan.params)
    .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
    .join(', ');
  const base = `Dashboard: ${plan.title}
User request: ${userPrompt}
Declared params: ${params || '(none)'}

Widget to bind:
- id: ${widget.id}
- type: ${widget.type}
- insight: ${widget.insight}`;

  if (!feedback) return base;
  return `${base}

Your previous SQL failed. Fix it.
Previous SQL:
${feedback.sql}

Database error:
${feedback.error}`;
}

export function copySystemPrompt(): string {
  return `You write microcopy for dashboard widgets: a tight title (max 8 words, sentence case, no trailing period) and a one-line insight caption (max 120 chars) that states what the data actually shows — a finding, not a description of the chart.

${JSON_ONLY}
Output: {"title": string, "caption": string}`;
}

export function copyUserPrompt(request: CopyRequest): string {
  return `Dashboard: ${request.dashboardTitle}
Widget intent: ${request.insight}
Current title: ${request.currentTitle ?? '(none)'}
Sample of the data it shows (JSON rows):
${JSON.stringify(request.sampleRows.slice(0, 8))}`;
}

export function refineSystemPrompt(dictionary: DataDictionary): string {
  return `You refine an existing Alpona dashboard spec. You receive the current spec (JSON) and a user instruction; you emit RFC 6902 JSON Patch operations against the spec — only what changed.

DATA AVAILABLE:

${dictionaryToPrompt(dictionary)}

WIDGET CONTRACTS:

${widgetContractsForPrompt()}

Rules:
- Address widgets by array index (e.g. /widgets/2/binding/sql). Use the spec you are given to find indices.
- Keep edits minimal: prefer replacing a widget's sql/props/copy over replacing whole widgets; add/remove widgets only when asked.
- New widgets must satisfy their slot's accepted types and the widget's resultShape contract, with ids in kebab-case.
- Never modify /specVersion. SQL must remain a single SELECT against the tables above.

${JSON_ONLY}
Output: {"operations": [{"op", "path", "value"?, "from"?}]}`;
}

export function refineUserPrompt(
  spec: DashboardSpec,
  prompt: string,
  targetWidgetId?: string,
): string {
  const target = targetWidgetId
    ? `\nThe user has selected widget id "${targetWidgetId}" — scope the change to it unless the instruction clearly says otherwise.`
    : '';
  return `Current spec:
${JSON.stringify(spec, null, 1)}
${target}
Instruction: ${prompt}`;
}

// ── Intent classification (D7: an LLM node, no UI toggle) ──────────

export function classifySystemPrompt(): string {
  return `You route input for Alpona, a generative dashboard tool with one prompt box. Classify the user's input:
- "ask": a question seeking an answer or a number ("how many…", "which carrier is slowest?", "did we miss SLA last week?").
- "build": a description of a view to create ("ops dashboard for…", "show me X by Y", "supplier scorecard with…").
Lean "build" when the input names multiple visualizations or an audience; lean "ask" when a single fact or figure would satisfy it.

${JSON_ONLY}
Output: {"intent": "ask" | "build"}`;
}

// ── Ask mode (D8: reuses the binder gates; the prompt differs) ──────

export function askSystemPrompt(dictionary: DataDictionary, dialect: string): string {
  return `You answer ONE data question for Alpona by writing ONE SQL query whose result contains the answer.

DATA AVAILABLE (the only tables that exist — never invent columns):

${dictionaryToPrompt(dictionary)}

Rules:
- ${dialect} dialect. One SELECT statement only. CTEs and window functions are fine.
- Aggregate to the smallest result that answers the question — ideally one row, one or two columns. Alias columns to short readable snake_case names.
- No params: inline literal values (dates as ISO strings, CAST when comparing to date columns).
- "title" is the question restated as a short label (max 8 words).

${JSON_ONLY}
Output: {"sql": string, "resultShape": {}, "title": string}`;
}

export function askUserPrompt(question: string, feedback?: { sql: string; error: string }): string {
  if (!feedback) return `Question: ${question}`;
  return `Question: ${question}

Your previous SQL failed. Fix it.
Previous SQL:
${feedback.sql}

Database error:
${feedback.error}`;
}

export function answerSystemPrompt(): string {
  return `You state the answer to a data question in ONE sentence (max 200 chars), grounded ONLY in the query result rows you are given — never invent numbers. Include the key figure in the sentence. Also extract "value": the single headline number or label when the result reduces to one (else null).

${JSON_ONLY}
Output: {"answer": string, "value": string | number | null}`;
}

export function answerUserPrompt(request: {
  prompt: string;
  sql: string;
  rows: Record<string, unknown>[];
}): string {
  return `Question: ${request.prompt}
SQL that ran:
${request.sql}
Result rows (JSON):
${JSON.stringify(request.rows.slice(0, 20))}`;
}
