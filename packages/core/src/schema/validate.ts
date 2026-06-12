import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import dashboardSpecSchema from './dashboard-spec.schema.json' with { type: 'json' };
import type { DashboardSpec, SpecIssue } from '../types.js';

let compiled: ValidateFunction | undefined;

function validator(): ValidateFunction {
  if (!compiled) {
    const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
    compiled = ajv.compile(dashboardSpecSchema);
  }
  return compiled;
}

/**
 * Structural gate: checks an untrusted value against the DashboardSpec
 * JSON Schema. This is the first of two validation layers — the
 * interpreter performs the semantic pass (registry, layout, contracts).
 */
export function validateSpecShape(value: unknown): { spec?: DashboardSpec; issues: SpecIssue[] } {
  const validate = validator();
  if (validate(value)) {
    return { spec: value as unknown as DashboardSpec, issues: [] };
  }
  const issues: SpecIssue[] = (validate.errors ?? []).map((err) => ({
    path: err.instancePath || '/',
    code: 'schema',
    message: `${err.message ?? 'invalid'}${err.keyword === 'additionalProperties' ? ` (${String((err.params as { additionalProperty?: string }).additionalProperty)})` : ''}`,
  }));
  return { issues };
}
