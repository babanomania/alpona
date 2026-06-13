/**
 * The data dictionary — the fourth contract.
 *
 * Generated from the live, migrated schema by `alpona dictionary`; never
 * hand-drifted. It is the ONLY place domain knowledge lives: the planner and
 * binder prompts are grounded in it, and the query guardrails derive their
 * table allowlist from it. Schema, dictionary, and agent grounding cannot
 * disagree.
 */

export interface DictionaryColumn {
  name: string;
  /** Database type, e.g. "integer", "timestamp", "numeric(10,2)". */
  type: string;
  /** Human/agent-facing meaning, merged from semantics.json. */
  description?: string;
  /** Approximate distinct-value count — guides chart cardinality choices. */
  cardinality?: number;
  /** A few representative values, for agent grounding. Never secrets. */
  samples?: (string | number | boolean | null)[];
  /** Synonyms written once at dictionary build time — retrieval recall aid. */
  aliases?: string[];
}

export interface DictionaryTable {
  name: string;
  /** Marts (analytical views) are preferred binding targets over raw tables. */
  kind: 'table' | 'mart';
  description?: string;
  rowCount?: number;
  columns: DictionaryColumn[];
  /** Synonyms written once at dictionary build time — retrieval recall aid. */
  aliases?: string[];
}

export interface DataDictionary {
  /** Dictionary format version. */
  version: 1;
  dialect: 'postgres' | 'duckdb';
  generatedAt: string;
  tables: DictionaryTable[];
}

/** The query-service allowlist is derived, never hand-maintained. */
export function allowedTables(dictionary: DataDictionary): Set<string> {
  return new Set(dictionary.tables.map((t) => t.name.toLowerCase()));
}

/** Renders the dictionary as compact prompt grounding (DDL-ish + semantics). */
export function dictionaryToPrompt(dictionary: DataDictionary): string {
  const marts = dictionary.tables.filter((t) => t.kind === 'mart');
  const tables = dictionary.tables.filter((t) => t.kind === 'table');
  const render = (t: DictionaryTable) => {
    const cols = t.columns
      .map((c) => {
        const notes: string[] = [];
        if (c.description) notes.push(c.description);
        if (c.cardinality !== undefined) notes.push(`~${c.cardinality} distinct`);
        if (c.samples?.length) notes.push(`e.g. ${c.samples.slice(0, 3).map(String).join(', ')}`);
        return `  ${c.name} ${c.type}${notes.length ? ` — ${notes.join('; ')}` : ''}`;
      })
      .join('\n');
    const header = `${t.name} (${t.kind}${t.rowCount !== undefined ? `, ~${t.rowCount} rows` : ''})${t.description ? ` — ${t.description}` : ''}`;
    return `${header}\n${cols}`;
  };
  const sections: string[] = [];
  if (marts.length)
    sections.push(`ANALYTICAL VIEWS (prefer these):\n\n${marts.map(render).join('\n\n')}`);
  if (tables.length) sections.push(`RAW TABLES:\n\n${tables.map(render).join('\n\n')}`);
  return sections.join('\n\n');
}
