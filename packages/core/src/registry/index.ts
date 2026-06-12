import { widgetDefinitions } from './definitions.js';
import type { WidgetDefinition } from './definitions.js';

export { widgetDefinitions } from './definitions.js';
export type { WidgetDefinition, ResultShapeContract, WidgetSizing } from './definitions.js';

const byType = new Map<string, WidgetDefinition>(widgetDefinitions.map((d) => [d.type, d]));

export function getWidgetDefinition(type: string): WidgetDefinition | undefined {
  return byType.get(type);
}

export function widgetTypes(): string[] {
  return widgetDefinitions.map((d) => d.type);
}
