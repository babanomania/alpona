import type { DataDictionary, DictionaryTable } from '@alpona/core';
import { dictionaryToPrompt } from '@alpona/core';

/**
 * Grounding retrieval (decision D9). BM25 is lexical and the backfire
 * risk is real, so every safeguard from the decision log is structural:
 *
 *  (a) Conditional — when the full dictionary fits the prompt budget, it
 *      is passed through untouched. Retrieval only activates above the
 *      threshold, so small schemas never lose grounding.
 *  (b) Alias-aware — `aliases` written into the dictionary at build time
 *      (`alpona dictionary`) are first-class match terms.
 *  (c) Recall-biased — generous k, and every mart is always included:
 *      marts are the curated analytical surface and never get dropped.
 *  (d) Fallback — callers retry failed binds with the FULL dictionary
 *      (see the graph's self-heal path); retrieval can narrow a prompt,
 *      never a capability.
 */

export interface RetrievalOptions {
  /**
   * Prompt-size threshold in characters (~4 chars/token). Default ≈6k
   * tokens — comfortable inside a 16k-context local model after the
   * static prompt sections.
   */
  budgetChars?: number;
  /** Non-mart tables to keep, beyond all marts. Recall-biased default. */
  k?: number;
}

export interface RetrievalResult {
  dictionary: DataDictionary;
  /** False when the full dictionary fit the budget (passthrough). */
  narrowed: boolean;
}

const DEFAULT_BUDGET_CHARS = 24_000;
const DEFAULT_K = 8;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

function tableTerms(table: DictionaryTable): string[] {
  const parts: string[] = [
    table.name,
    table.description ?? '',
    ...(table.aliases ?? []),
    ...table.columns.flatMap((c) => [c.name, c.description ?? '', ...(c.aliases ?? [])]),
  ];
  return tokenize(parts.join(' '));
}

/** Classic BM25 over the dictionary's tables as the document set. */
function bm25Scores(tables: DictionaryTable[], query: string): number[] {
  const k1 = 1.5;
  const b = 0.75;
  const docs = tables.map(tableTerms);
  const avgLen = docs.reduce((sum, d) => sum + d.length, 0) / Math.max(docs.length, 1);
  const queryTerms = [...new Set(tokenize(query))];

  return docs.map((doc) => {
    const length = doc.length || 1;
    const counts = new Map<string, number>();
    for (const term of doc) counts.set(term, (counts.get(term) ?? 0) + 1);
    let score = 0;
    for (const term of queryTerms) {
      const tf = counts.get(term) ?? 0;
      if (tf === 0) continue;
      const df = docs.filter((d) => d.includes(term)).length;
      const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
      score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * length) / avgLen));
    }
    return score;
  });
}

/**
 * Returns the grounding dictionary for one query: the full dictionary
 * when it fits the budget, otherwise all marts plus the top-k BM25
 * matches among the remaining tables.
 */
export function retrieveDictionary(
  full: DataDictionary,
  query: string,
  options: RetrievalOptions = {},
): RetrievalResult {
  const budget = options.budgetChars ?? DEFAULT_BUDGET_CHARS;
  if (dictionaryToPrompt(full).length <= budget) {
    return { dictionary: full, narrowed: false };
  }

  const k = options.k ?? DEFAULT_K;
  const scores = bm25Scores(full.tables, query);
  const ranked = full.tables
    .map((table, i) => ({ table, score: scores[i]! }))
    .sort((a, b) => b.score - a.score);

  const keep = new Set<string>(full.tables.filter((t) => t.kind === 'mart').map((t) => t.name));
  for (const { table } of ranked) {
    if (keep.size >= k + full.tables.filter((t) => t.kind === 'mart').length) break;
    keep.add(table.name);
  }

  return {
    dictionary: { ...full, tables: full.tables.filter((t) => keep.has(t.name)) },
    narrowed: true,
  };
}
