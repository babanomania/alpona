import type {
  Composition,
  CompositionDiagnostic,
  DashboardSpec,
  LayoutTemplate,
  SlotContract,
  WidgetPlacement,
  WidgetSpec,
} from '../types.js';
import { getWidgetDefinition } from '../registry/index.js';
import type { WidgetSizing } from '../registry/index.js';

/**
 * The composer is pure code: the agent proposes widgets per slot, the
 * composer disposes. It enforces slot contracts (count limits, overflow
 * rules) and solves the 12-column grid deterministically — same spec,
 * same pixels, every time.
 */

const FALLBACK_SIZING: WidgetSizing = { minW: 2, minH: 2, defaultW: 4, defaultH: 3 };

function sizingOf(widget: WidgetSpec): WidgetSizing {
  return getWidgetDefinition(widget.type)?.sizing ?? FALLBACK_SIZING;
}

interface SlotResult {
  placements: WidgetPlacement[];
  /** Rows actually consumed; may exceed the declared region height when wrapping. */
  actualH: number;
}

/** Splits `total` into `n` integer parts, distributing the remainder left-first. */
function split(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const rem = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

function packRow(
  slot: SlotContract,
  widgets: WidgetSpec[],
  diagnostics: CompositionDiagnostic[],
): SlotResult {
  const { region } = slot;
  const maxMinW = Math.max(...widgets.map((w) => sizingOf(w).minW));
  const perRow = Math.max(1, Math.min(widgets.length, Math.floor(region.w / maxMinW)));

  let kept = widgets;
  if (widgets.length > perRow && slot.overflow === 'truncate') {
    kept = widgets.slice(0, perRow);
    for (const dropped of widgets.slice(perRow)) {
      diagnostics.push({
        severity: 'warning',
        slot: slot.id,
        widgetId: dropped.id,
        message: `dropped: slot "${slot.id}" fits ${perRow} widgets per row (overflow=truncate)`,
      });
    }
  }

  const rowCount = Math.ceil(kept.length / perRow);
  const rowH = rowCount === 1 ? region.h : Math.max(...kept.map((w) => sizingOf(w).minH));
  const placements: WidgetPlacement[] = [];

  for (let r = 0; r < rowCount; r++) {
    const rowWidgets = kept.slice(r * perRow, (r + 1) * perRow);
    const widths = split(region.w, rowWidgets.length);
    let x = region.x;
    rowWidgets.forEach((w, i) => {
      placements.push({
        widgetId: w.id,
        slot: slot.id,
        x,
        y: region.y + r * rowH,
        w: widths[i]!,
        h: rowH,
      });
      x += widths[i]!;
    });
  }

  return { placements, actualH: rowCount * rowH };
}

function packColumn(
  slot: SlotContract,
  widgets: WidgetSpec[],
  _diagnostics: CompositionDiagnostic[],
): SlotResult {
  const { region } = slot;
  // The slot contract is authoritative here: the designer declared how many
  // widgets the rail holds (maxWidgets is enforced upstream), so the region
  // height is split evenly — extending only when there are more rows than
  // grid units.
  const heights =
    widgets.length <= region.h ? split(region.h, widgets.length) : widgets.map(() => 1);
  const placements: WidgetPlacement[] = [];
  let y = region.y;
  widgets.forEach((w, i) => {
    placements.push({ widgetId: w.id, slot: slot.id, x: region.x, y, w: region.w, h: heights[i]! });
    y += heights[i]!;
  });

  return { placements, actualH: y - region.y };
}

function packGrid(
  slot: SlotContract,
  widgets: WidgetSpec[],
  diagnostics: CompositionDiagnostic[],
): SlotResult {
  const { region } = slot;
  const maxMinW = Math.max(...widgets.map((w) => sizingOf(w).minW));
  const maxMinH = Math.max(...widgets.map((w) => sizingOf(w).minH));
  const maxCols = Math.max(1, Math.floor(region.w / maxMinW));

  let kept = widgets;
  if (slot.overflow === 'truncate') {
    const capacity = maxCols * Math.max(1, Math.floor(region.h / maxMinH));
    if (widgets.length > capacity) {
      kept = widgets.slice(0, capacity);
      for (const dropped of widgets.slice(capacity)) {
        diagnostics.push({
          severity: 'warning',
          slot: slot.id,
          widgetId: dropped.id,
          message: `dropped: slot "${slot.id}" grid capacity is ${capacity} (overflow=truncate)`,
        });
      }
    }
  }

  const rows = Math.ceil(kept.length / maxCols);
  const cols = Math.ceil(kept.length / rows);
  const cellH = Math.max(maxMinH, Math.floor(region.h / rows));
  const widths = split(region.w, cols);
  const placements: WidgetPlacement[] = [];

  kept.forEach((w, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = region.x + widths.slice(0, c).reduce((a, b) => a + b, 0);
    placements.push({
      widgetId: w.id,
      slot: slot.id,
      x,
      y: region.y + r * cellH,
      w: widths[c]!,
      h: cellH,
    });
  });

  return { placements, actualH: rows * cellH };
}

export function compose(spec: DashboardSpec, layout: LayoutTemplate): Composition {
  const diagnostics: CompositionDiagnostic[] = [];
  const placements: WidgetPlacement[] = [];

  const bySlot = new Map<string, WidgetSpec[]>();
  for (const widget of spec.widgets) {
    const slot = layout.slots.find((s) => s.id === widget.slot);
    if (!slot) {
      diagnostics.push({
        severity: 'warning',
        slot: widget.slot,
        widgetId: widget.id,
        message: `widget targets unknown slot "${widget.slot}" and was skipped`,
      });
      continue;
    }
    const list = bySlot.get(slot.id) ?? [];
    list.push(widget);
    bySlot.set(slot.id, list);
  }

  // Slots sharing a region.y form a band; bands shift down together when an
  // earlier band wraps past its declared height.
  const bands = new Map<number, SlotContract[]>();
  for (const slot of layout.slots) {
    const band = bands.get(slot.region.y) ?? [];
    band.push(slot);
    bands.set(slot.region.y, band);
  }

  let yShift = 0;
  let totalRows = 0;

  for (const bandY of [...bands.keys()].sort((a, b) => a - b)) {
    let bandActualH = 0;
    for (const slot of bands.get(bandY)!) {
      let widgets = bySlot.get(slot.id) ?? [];

      if (widgets.length > slot.maxWidgets) {
        if (slot.overflow === 'truncate') {
          for (const dropped of widgets.slice(slot.maxWidgets)) {
            diagnostics.push({
              severity: 'warning',
              slot: slot.id,
              widgetId: dropped.id,
              message: `dropped: slot "${slot.id}" accepts at most ${slot.maxWidgets} widgets`,
            });
          }
          widgets = widgets.slice(0, slot.maxWidgets);
        }
        // overflow=wrap keeps everything; the packer extends the region.
      }
      if (widgets.length < slot.minWidgets) {
        diagnostics.push({
          severity: 'info',
          slot: slot.id,
          message: `slot "${slot.id}" has ${widgets.length} widgets (minimum suggested: ${slot.minWidgets})`,
        });
      }
      if (widgets.length === 0) continue;

      const packer =
        slot.packing === 'column' ? packColumn : slot.packing === 'grid' ? packGrid : packRow;
      const result = packer(slot, widgets, diagnostics);
      for (const p of result.placements) {
        placements.push({ ...p, y: p.y + yShift });
        totalRows = Math.max(totalRows, p.y + yShift + p.h);
      }
      bandActualH = Math.max(bandActualH, result.actualH);
    }
    const declaredH = Math.max(...bands.get(bandY)!.map((s) => s.region.h));
    if (bandActualH > declaredH) yShift += bandActualH - declaredH;
  }

  return { placements, rows: totalRows, diagnostics };
}
