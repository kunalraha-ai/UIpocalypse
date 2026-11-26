import type { AppMap, Issue } from '../analyzer/types.js';
import type { RiskClass } from '../guard/actions.js';
import { classifyAction } from '../guard/actions.js';

/**
 * Static ↔ runtime corroboration (2026-11-26). The analyzer's app-map knows
 * each control's component file and the HTTP methods that file fires; the
 * runtime knows what the control actually did. This join fixes both failure
 * modes of label-regex risk classes:
 *
 *   upgrade:   "Nuke record" (benign label) + DELETE in its component file
 *              → destructive, skipped as such
 *   downgrade: "Remove filter" (destructive-sounding label) + a component
 *              file that provably writes nothing → write (testable)
 *
 * Fail-safe by construction: no source map (URL-only runs), no element
 * match, or an empty (icon-only) label → the label verdict stands. For
 * duplicate labels the strongest method across the matching files wins.
 *
 * Method evidence only ever moves a DESTRUCTIVE label verdict — external
 * labels (webhooks/email triggers) are untouched: a GET can still fire
 * server-side side effects.
 */

export function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60);
}

export type EnrichedRisk = { risk: RiskClass; via: 'label' | 'method'; method?: string };

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function enrichedRisk(appMap: AppMap | undefined, label: string): EnrichedRisk {
  const labelRisk = classifyAction({ id: 'corroborate', label });
  const key = normalizeLabel(label);
  // fail-safe: no map, no usable label, no match → label verdict
  if (!appMap || !key) return { risk: labelRisk, via: 'label' };
  const files = new Set(
    appMap.elements.filter((e) => normalizeLabel(e.label) === key && e.file).map((e) => e.file),
  );
  if (files.size === 0) return { risk: labelRisk, via: 'label' };

  const methods = appMap.apiCalls.filter((c) => files.has(c.file)).map((c) => c.method.toUpperCase());
  const hasDelete = methods.includes('DELETE');
  const hasWrite = methods.some((m) => WRITE_METHODS.has(m));

  if (hasDelete) return { risk: 'destructive', via: 'method', method: 'DELETE' };
  if (labelRisk === 'destructive') {
    // the label says destructive; the source says this component never
    // writes. Downgrade to write (testable), never to safe — a mispredicted
    // method must not turn a "delete"-looking control into a free click.
    return hasWrite
      ? { risk: 'destructive', via: 'label' }
      : { risk: 'write', via: 'method', method: methods[0] ?? undefined };
  }
  if (hasWrite) return { risk: 'write', via: 'method', method: methods.find((m) => WRITE_METHODS.has(m)) };
  return { risk: labelRisk, via: 'label' };
}

/** Normalized labels of every static dead-handler issue (the join key for
 *  runtime dead clicks: source and runtime flag the same control). */
export function deadHandlerLabels(staticIssues: Issue[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const issue of staticIssues ?? []) {
    if (issue.rule !== 'dead-handler') continue;
    const m = issue.message.match(/"([^"]*)"/);
    if (m && m[1]) {
      const normalized = normalizeLabel(m[1]);
      if (normalized) out.add(normalized);
    }
  }
  return out;
}

/** Annotate a dead_click evidence object when the static side flags the same
 *  control. Mutates in place; no static counterpart → untouched (static
 *  analysis has false negatives — silence is never a downgrade). */
export function annotateCorroboration(
  evidence: { action?: unknown; corroboration?: string },
  staticLabels: Set<string>,
): void {
  const action = typeof evidence.action === 'string' ? evidence.action : '';
  if (!action || !staticLabels.has(normalizeLabel(action))) return;
  evidence.corroboration = 'static dead-handler issue matches this control — source and runtime agree';
}
