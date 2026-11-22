import { describe, expect, it } from 'vitest';
import { parseCSV } from '../utils/csvParser';
import { catalogForPlanner } from './catalog';
import { catalogLines, compactColumns, relevantCapabilities, rolesLine } from './plannerContext';

const rows = Array.from({ length: 50 }, (_, i) => ({ id: i, month: `2024-${String(1 + (i % 12)).padStart(2, '0')}-01`, region: i % 2 ? 'North' : 'South', revenue: 100 + i, churn: i % 3 ? 'No' : 'Yes' }));
const ds = parseCSV(['id,month,region,revenue,churn', ...rows.map(r => Object.values(r).join(','))].join('\n'), 'x.csv');

describe('the AI planner gets a small, focused request', () => {
  it('sends a fraction of the catalog, always with what the request needs', () => {
    const cases: [string, string[]][] = [
      ['which customers are most likely to leave and how much revenue is at risk', ['models.train', 'models.automl']],
      ['find unusual spikes in revenue over time and forecast next quarter', ['models.forecast']],
      ['build a dashboard of revenue by region and write a report', ['dashboard.design', 'report.build']],
      ['did the campaign cause more sales? use a proper causal method', ['analysis.propensity', 'analysis.did']],
      ['clean the data and fix the missing values', ['quality.check']],
    ];
    const full = catalogForPlanner().length;
    for (const [q, need] of cases) {
      const ids = relevantCapabilities(q);
      expect(ids.length).toBeLessThanOrEqual(26);
      for (const n of need) expect(ids, `${q} → ${n}`).toContain(n);
      const sent = catalogLines(ids).length + rolesLine(ids).length;
      expect(sent, q).toBeLessThan(full / 2.5);
    }
  });
  it('describes the columns in one compact line', () => {
    const c = compactColumns(ds);
    expect(c).toContain('revenue (numeric, 100–149, mean 124.5)');
    expect(c).toContain('region (categorical, 2 distinct, e.g.');
    expect(c.length).toBeLessThan(400);
  });
});
