import { describe, expect, it } from 'vitest';
import { parseCSV } from '../utils/csvParser';
import { rulePlan, validatePlan } from './plan';
import { methodsNamed } from './methodPlan';

// Like the churn file people load: an id, a month, two categories, numbers and a yes/no outcome.
const rows = Array.from({ length: 120 }, (_, i) => ({
  customer_id: 1000 + i, month: `2021-${String((i % 12) + 1).padStart(2, '0')}-01`, region: i % 2 ? 'North' : 'South',
  contract: ['Monthly', 'One year', 'Two year'][i % 3], email: `user${i}@example.com`,
  tenure: 1 + (i * 7) % 60, charges: 20 + (i * 13) % 90, revenue: 800 + (i * 37) % 1200, churn: i % 4 ? 'No' : 'Yes',
}));
const head = Object.keys(rows[0]);
const ds = parseCSV([head.join(','), ...rows.map(r => head.map(h => (r as any)[h]).join(','))].join('\n'), 'churn.csv');
const plan = (q: string) => rulePlan(q, ds, { engine: 'ready' });

describe('planning the engine’s analyses without AI', () => {
  it('splits a two-part request into the two methods it names, each on its own columns', () => {
    const p = plan('compare revenue across regions with a bayesian test and check whether tenure is normally distributed');
    expect(p.tasks.map(t => [t.capability, t.params])).toEqual([
      ['analysis.bayes-ab', { variant: 'region', metric: 'revenue' }],
      ['analysis.normality', { column: 'tenure' }],
    ]);
    expect(validatePlan(p.tasks, ds)).toEqual([]);
  });
  it('fills what the request leaves out from the data, sensibly', () => {
    expect(plan('how long until customers churn?').tasks[0]).toMatchObject({ capability: 'analysis.km', params: { duration: 'tenure', event: 'churn' } });
    expect(plan('is there seasonality in charges').tasks[0]).toMatchObject({ capability: 'analysis.decompose', params: { date: 'month', value: 'charges' } });
    expect(plan('find personal data in this file').tasks[0].capability).toBe('analysis.pii');
    expect(plan('run an anova of revenue by contract').tasks[0]).toMatchObject({ capability: 'analysis.anova', params: { outcome: 'revenue', factors: ['contract'] } });
  });
  it('leaves to the AI what it can’t fill, instead of guessing', () => {
    // Difference-in-differences needs treated and after flags this data doesn't have.
    expect(methodsNamed('difference-in-differences on revenue').map(m => m.id)).toEqual(['did']);
    expect(plan('difference-in-differences on revenue').tasks).toEqual([]);
  });
  it('still plans churn prediction from everyday words', () => {
    expect(plan('which customers are likely to leave?').tasks.map(t => t.capability)).toContain('models.train');
  });
});
