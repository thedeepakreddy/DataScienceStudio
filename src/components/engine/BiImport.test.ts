import { describe, expect, it } from 'vitest';
import { kpisFor } from './BiImport';

describe('workbook calculations as dashboard KPIs', () => {
  it('keeps converted calculations whose columns exist, with the table’s own spelling', () => {
    const kpis = kpisFor([
      { name: 'Total Sales', formula: 'SUM([Sales])', kpi: 'SUM([sales])', status: 'converted' },
      { name: 'Profit Ratio', formula: 'SUM([Profit])/SUM([Sales])', kpi: 'SUM([Profit]) / SUM([Sales])', status: 'converted' },
      { name: 'Missing', formula: 'SUM([Other])', kpi: 'SUM([Other])', status: 'converted' },
      { name: 'LOD', formula: '{FIXED [Region]: SUM([Sales])}', kpi: null, status: 'skipped' },
    ], ['Sales', 'Profit', 'Region']);
    expect(kpis.map(k => [k.name, k.formula, k.format])).toEqual([
      ['Total Sales', 'SUM([Sales])', 'currency'],
      ['Profit Ratio', 'SUM([Profit]) / SUM([Sales])', 'percent'],
    ]);
    expect(new Set(kpis.map(k => k.id)).size).toBe(2);
  });
});
