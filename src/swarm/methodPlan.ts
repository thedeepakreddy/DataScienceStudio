/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Dataset } from '../types';
import { isIdentifierColumn } from '../utils/csvParser';
import { ENGINE_METHODS } from '../components/stats/methods';
import { columnsFor, type Field } from '../components/stats/methodKit';
import { CAPABILITIES } from './catalog';
import { validateMethod } from './engineCapabilities';
import { mentionedColumns } from './text';

// Plans the engine's specialised analyses from plain words, without AI: the
// request names a method ("bayesian", "normally distributed", "survival",
// "difference-in-differences", "seasonality", "personal data" …) and the method's
// column fields are filled from the columns named in that part of the request,
// then from the data's most suitable columns. A method is planned only when all
// its required fields can be filled and the plan passes the same checks as any
// other; otherwise the request is left to the AI planner.

const METHOD_WORDS: [RegExp, string][] = [
  [/bayes(ian)? (a\/?b|ab)|bayes(ian)? .*(compare|comparison|test of|across|between|variants?)|(compare|comparison|across|between) .*bayes|probability (that )?each .* best|chance (that )?each .* best/, 'bayes-ab'],
  [/bayes ?factor|bayesian t.?test/, 'bayes-t'],
  [/bayesian regression/, 'bayes-reg'],
  [/normal(ly)? distributed|normality|follows? a normal|bell.?curve|gaussian distribution/, 'normality'],
  [/survival|kaplan|how long until|time (until|to) (churn|leave|cancel|fail|event)/, 'km'],
  [/\bcox\b|hazard|what changes the risk/, 'cox'],
  [/propensity|treatment effect|causal effect|effect of (the )?(treatment|campaign|programme|program|intervention)/, 'propensity'],
  [/difference.in.differences|\bdiff.in.diff\b/, 'did'],
  [/instrumental variables?|\b2sls\b/, 'iv'],
  [/regression discontinuity|\brdd\b/, 'rdd'],
  [/\buplift\b|who responds (best|most)/, 'uplift'],
  [/(^|[^a-z])(a\/b|ab) test|split test|experiment results/, 'ab'],
  [/\banova\b|\bancova\b/, 'anova'],
  [/mixed.?(effects? )?model|repeated measures|random effects?/, 'mixed'],
  [/robust regression|quantile regression|regression .*resist/, 'robust'],
  [/\bglm\b|poisson regression|generali[sz]ed linear/, 'glm'],
  [/bootstrap/, 'bootstrap'],
  [/personal data|\bpii\b|sensitive (data|fields|information)/, 'pii'],
  [/\bmask\b|anonymi[sz]e|pseudonymi[sz]e/, 'mask'],
  [/\bpca\b|\bumap\b|t-?sne|map (of )?the data|dimensionality reduction/, 'map'],
  [/market basket|bought together|association rules/, 'basket'],
  [/seasonal(ity)?|decompos/, 'decompose'],
  [/anomal(y|ies)|unusual (points|days|weeks|months|spikes)|spikes? in/, 'anomalies'],
  [/change ?points?|level shifts?|when .* (changed|shifted)/, 'changes'],
  [/correlation matrix|partial correlation|correlations? (between|among) (all|every)/, 'correlation'],
  [/non.?parametric|mann.?whitney|kruskal|wilcoxon/, 'nonparametric'],
  [/feature selection|boruta|which (columns|features|variables) (help|matter|are useful)/, 'features'],
  [/sentiment|key ?words|topics|text analysis|analy[sz]e (the )?(text|reviews?|comments?|feedback)/, 'text-overview'],
  [/(near.?)?duplicate (texts?|reviews?|comments?|messages?)/, 'text-duplicates'],
  [/texts? by meaning|semantic map/, 'text-map'],
  [/hierarchical forecast|forecasts? that add up/, 'hierarchical'],
];

export interface MethodTask { capability: string; params: Record<string, unknown>; why: string; at: number }

/** The engine methods a request names, in the order they appear. */
export function methodsNamed(request: string): { id: string; at: number }[] {
  const text = request.toLowerCase();
  const out: { id: string; at: number }[] = [];
  for (const [re, id] of METHOD_WORDS) {
    const m = re.exec(text);
    if (m && CAPABILITIES[`analysis.${id}`] && !out.some(o => o.id === id)) out.push({ id, at: m.index });
  }
  // A Bayesian comparison is not also a plain A/B test.
  if (out.some(o => o.id === 'bayes-ab')) return out.filter(o => o.id !== 'ab').sort((a, b) => a.at - b.at);
  return out.sort((a, b) => a.at - b.at);
}

/** The part of the request around position `at` (split at "and", commas, "then"). */
function clauseAt(request: string, at: number): string {
  const parts = request.split(/(,|;|\band\b|\bthen\b|\balso\b)/i);
  let pos = 0;
  for (const p of parts) {
    if (at >= pos && at < pos + p.length) return p;
    pos += p.length;
  }
  return request;
}

const EVENT_RE = /(churn|event|died|death|failed|failure|default|cancel|left|attrition|exited|converted|outcome)/i;
const DURATION_RE = /(tenure|duration|days|weeks|months|years|lifetime|time|age)/i;

/** Causal methods only run on columns you name: a guessed treatment or cut-off would mislead. */
const NAMED_ONLY = new Set(['propensity', 'did', 'iv', 'rdd', 'uplift', 'synth']);
/** Methods that look at every column when none is named. */
const ALL_COLUMNS = new Set(['pii', 'mask', 'profile']);
const DATE_NAME = /date|time|day|week|month|year|period|quarter/i;

/** Fills a method's fields from the clause's columns, then the request's, then sensible defaults. */
function fill(id: string, fields: Field[], ds: Dataset, clauseCols: string[], allCols: string[], target?: string): Record<string, unknown> | null {
  const params: Record<string, unknown> = {};
  const used = new Set<string>();
  const col = (name: string) => ds.columns.find(x => x.name === name)!;
  // A "date" field takes real dates (or date-named columns), never an ordinary number.
  const fits = (c: string, filter: Parameters<typeof columnsFor>[1]) => columnsFor(ds, filter).includes(c) && (filter !== 'date' || col(c).type === 'datetime' || DATE_NAME.test(c));
  const usable = (filter: Parameters<typeof columnsFor>[1]) => columnsFor(ds, filter).filter(c => fits(c, filter) && !isIdentifierColumn(col(c), ds.rowCount));
  const fromWords = (filter: Parameters<typeof columnsFor>[1]) => [...clauseCols, ...allCols].filter((c, i, a) => a.indexOf(c) === i && fits(c, filter) && !used.has(c));
  for (const f of fields) {
    if (f.kind === 'column') {
      let pick = fromWords(f.filter)[0];
      if (!pick && !f.optional && !NAMED_ONLY.has(id)) {
        const options = usable(f.filter).filter(c => !used.has(c));
        pick = f.filter === 'binary' ? options.find(c => c === target) ?? options.find(c => EVENT_RE.test(c)) ?? options[0]
          : f.key === 'duration' ? options.find(c => DURATION_RE.test(c)) ?? options[0]
            : options.find(c => c === target && f.key === 'outcome') ?? options[0];
      }
      if (pick) { params[f.key] = pick; used.add(pick); } else if (!f.optional) return null;
    } else if (f.kind === 'columns') {
      let picks = fromWords(f.filter);
      if (picks.length < (f.min ?? 1) && ALL_COLUMNS.has(id)) picks = ds.columns.map(c => c.name);
      if (picks.length < (f.min ?? 1) && NAMED_ONLY.has(id)) return null;
      if (picks.length < (f.min ?? 1)) picks = usable(f.filter).filter(c => !used.has(c) && ds.columns.find(x => x.name === c)?.type !== 'datetime').slice(0, 8);
      if (picks.length < (f.min ?? 1)) return null;
      params[f.key] = picks.slice(0, f.max ?? 12);
      picks.forEach(c => used.add(c));
    } else if (f.kind === 'text' && !f.optional && !f.default) return null; // needs words only you can give
    else if (f.kind === 'custom' || f.kind === 'arms') return null; // needs a table only you can fill
  }
  return params;
}

/** The engine analyses a request names, with their columns filled in, or nothing. */
export function methodPlan(request: string, ds: Dataset, target?: string): MethodTask[] {
  const all = mentionedColumns(request, ds);
  const out: MethodTask[] = [];
  for (const { id, at } of methodsNamed(request)) {
    const m = ENGINE_METHODS[id];
    if (!m) continue;
    const params = fill(id, m.fields, ds, mentionedColumns(clauseAt(request, at), ds), all, target);
    if (!params || validateMethod(m, params, ds)) continue;
    const cols = Object.values(params).flat().filter((v): v is string => typeof v === 'string' && ds.columns.some(c => c.name === v));
    out.push({ capability: `analysis.${id}`, params, at, why: `${m.title}${cols.length ? ` on ${cols.slice(0, 4).join(', ')}${cols.length > 4 ? '…' : ''}` : ''}.` });
  }
  return out;
}
