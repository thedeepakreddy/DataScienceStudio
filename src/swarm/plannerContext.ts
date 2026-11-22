/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Dataset } from '../types';
import { CAPABILITIES } from './catalog';
import { SKILLS } from './skills';
import { methodsNamed } from './methodPlan';
import type { AgentRole } from './agents';

// What the AI planner is sent, kept small so small models answer it well: only the
// capabilities the request points to (plus a few every plan may need), one line
// per specialist used, and a compact description of the columns. If a plan names
// a capability that wasn't sent, the gateway asks again once with the full list.

/** Capabilities almost any plan may need. */
const CORE = ['quality.check', 'explore.profile', 'stats.compare', 'stats.screen', 'models.train', 'models.automl', 'dashboard.design', 'report.build'];

/** Plain words → capability ids (or id prefixes ending in "."). */
const TOPICS: [RegExp, string[]][] = [
  [/clean|missing|null|blank|duplicate|tidy|fix|quality|type|convert|rename|drop|fill|replace|filter|remove|outlier/, ['quality.', 'data.', 'explore.deep_eda']],
  [/explore|profile|overview|describe|summar|distribution|skew|eda/, ['explore.', 'analysis.correlation', 'analysis.normality']],
  [/model|predict|train|classif|regress|churn|leave|risk|likely|forecast accuracy|feature/, ['models.', 'analysis.features']],
  [/forecast|future|next (day|week|month|quarter|year)|trend|season/, ['models.forecast', 'analysis.forecast', 'analysis.decompose', 'analysis.anomalies', 'analysis.changes']],
  [/segment|cluster|group|persona/, ['models.cluster', 'analysis.cluster', 'analysis.map']],
  [/dashboard|chart|visual|kpi|plot|graph|pin/, ['dashboard.']],
  [/report|pdf|write.?up|findings|package|export/, ['report.']],
  [/test|significan|compare|differ|relat|correlat|drive|factor|impact|effect|associat|anova|regress/, ['stats.', 'analysis.anova', 'analysis.glm', 'analysis.nonparametric', 'analysis.correlation']],
  [/sql|query|select|count|average|how many|total/, ['sql.query']],
  [/text|review|comment|feedback|sentiment|topic|keyword/, ['analysis.text-overview', 'analysis.text-duplicates', 'analysis.text-map']],
  [/drift|monitor|retrain|deploy|register|production/, ['models.monitor', 'models.retrain', 'models.score', 'deploy.']],
  [/explain|why|importance|shap|what drives/, ['models.explain', 'models.explain_engine', 'stats.screen']],
  [/causal|treatment|campaign|uplift|experiment|a\/?b|variant|lift/, ['analysis.propensity', 'analysis.did', 'analysis.uplift', 'analysis.ab', 'analysis.bayes-ab', 'analysis.srm', 'analysis.sample']],
  [/surviv|how long|time until|time to|hazard/, ['analysis.km', 'analysis.cox']],
  [/personal|pii|privacy|mask|anonym|gdpr/, ['analysis.pii', 'analysis.mask']],
  [/bayes/, ['analysis.bayes-ab', 'analysis.bayes-t', 'analysis.bayes-reg']],
  [/basket|bought together|association/, ['analysis.basket']],
  [/optimi[sz]|simulat|monte carlo|what.?if|scenario/, ['analysis.optimize', 'analysis.montecarlo', 'models.']],
  [/sample|reset|undo|workflow|import|load/, ['import.', 'data.reset', 'workflow.']],
];

const MAX_CAPS = 26;

/** The capability ids worth sending for this request, most relevant first. */
export function relevantCapabilities(request: string): string[] {
  const text = request.toLowerCase();
  const ids = Object.values(CAPABILITIES).filter(c => c.approval !== 'prohibited' && c.id !== 'verify.review').map(c => c.id);
  const score = new Map<string, number>();
  const bump = (id: string, by: number) => score.set(id, (score.get(id) ?? 0) + by);
  for (const [re, targets] of TOPICS) {
    if (!re.test(text)) continue;
    for (const t of targets) for (const id of ids) if (t.endsWith('.') ? id.startsWith(t) : id === t) bump(id, 3);
  }
  for (const m of methodsNamed(request)) if (ids.includes(`analysis.${m.id}`)) bump(`analysis.${m.id}`, 6);
  // Words of the request that appear in a capability's id or label.
  const words = (text.match(/[a-z]{4,}/g) ?? []).filter(w => !['with', 'this', 'that', 'what', 'data', 'from', 'show', 'make', 'please', 'which', 'about'].includes(w));
  for (const id of ids) {
    let label = '';
    try { label = CAPABILITIES[id].label({}).toLowerCase(); } catch { /* labels that need params */ }
    const hay = `${id.replace(/[._-]/g, ' ')} ${label}`;
    for (const w of words) if (hay.includes(w.slice(0, 5))) bump(id, 1);
  }
  const ranked = ids.filter(id => (score.get(id) ?? 0) > 0).sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0)).slice(0, MAX_CAPS - 4);
  return [...new Set([...ranked, ...CORE.filter(id => ids.includes(id))])].slice(0, MAX_CAPS);
}

const shortParams = (p: string) => (p.length > 220 ? `${p.slice(0, 217)}…` : p);

/** The planner's capability list: only `ids` (or every capability), one compact line each. */
export function catalogLines(ids?: string[]): string {
  const caps = ids ? ids.map(id => CAPABILITIES[id]).filter(Boolean) : Object.values(CAPABILITIES).filter(c => c.approval !== 'prohibited' && c.id !== 'verify.review');
  return caps.map(c => `- ${c.id} [${c.defaultRole}] ${shortParams(c.params)}`).join('\n');
}

/** One line per specialist that owns one of these capabilities. */
export function rolesLine(ids: string[]): string {
  const roles = [...new Set(ids.map(id => CAPABILITIES[id]?.defaultRole).filter(Boolean))] as AgentRole[];
  return roles.map(r => `${r}: ${SKILLS[r]?.mission ?? ''}`.slice(0, 120)).join('\n');
}

const r4 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toPrecision(4)) : undefined);

/** The columns in a compact form: name (type, gaps, range or common values). At most 60. */
export function compactColumns(ds: Dataset): string {
  return ds.columns.slice(0, 60).map(c => {
    const bits: string[] = [c.type];
    if (c.missingCount) bits.push(`${c.missingCount} missing`);
    if (c.type === 'numeric') {
      const mn = r4(c.statistics?.min), mx = r4(c.statistics?.max), mean = r4(c.statistics?.mean);
      if (mn !== undefined && mx !== undefined) bits.push(`${mn}–${mx}`);
      if (mean !== undefined) bits.push(`mean ${mean}`);
    } else {
      bits.push(`${c.distinctCount} distinct`);
      const top = (c.statistics?.mostCommon ?? []).slice(0, 3).map((m: any) => String(m.value ?? m).slice(0, 20));
      if (top.length && c.distinctCount <= 50) bits.push(`e.g. ${top.join('/')}`);
    }
    return `${c.name} (${bits.join(', ')})`;
  }).join('; ') + (ds.columns.length > 60 ? `; … ${ds.columns.length - 60} more columns` : '');
}
