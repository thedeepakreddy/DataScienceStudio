/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useContext, useRef, useState } from 'react';
import { LayoutDashboard, PackageOpen } from 'lucide-react';
import { engine, type DatasetMeta } from '../../engine/client';
import { DataTable } from '../stats/methodKit';
import UseEngineDataset, { StudioDataContext, loadEngineDataset } from './UseEngineDataset';
import Orb from '../Orb';
import { DASHBOARD_APPLIED_EVENT, DASHBOARD_APPLY_EVENT } from '../../swarm/uiScripts';
import { OPEN_STEP_EVENT } from '../../swarm/interaction';
import type { KpiDefinition } from '../../utils/kpiFormula';

/** The engine capability this card runs (through engine.importWorkbook). */
export const BI_CAPABILITY = 'connect.bi';

type Status = 'converted' | 'approximated' | 'skipped';
interface Sheet { name: string; chart: string | null; columns: string[]; status: Status; note?: string | null }
interface Calc { name: string; formula: string; kpi: string | null; status: Status; note?: string | null }
export interface BiResult {
  product: 'tableau' | 'powerbi';
  file: string;
  datasets: DatasetMeta[];
  dataset: DatasetMeta | null;
  design: { recommendedComponents: Array<{ type: string; columnsToUse: string[]; title: string }>; topKPIs: string[]; layout: string; detectedProblem: string } | null;
  sheets: Sheet[];
  calculations: Calc[];
  dashboards: Array<{ name: string; sheets: string[] }>;
  summary: { tables: number; sheets: number; sheetsConverted: number; sheetsApproximated: number; sheetsSkipped: number; calculations: number; calculationsConverted: number };
  notes?: string[];
}

const STATUS_LABEL: Record<Status, string> = { converted: 'Rebuilt', approximated: 'Close match', skipped: 'Not rebuilt' };
const statusChip = (s: Status) => (
  <span className={`text-xs font-medium ${s === 'converted' ? 'text-green' : s === 'approximated' ? 'text-orange' : 'text-label-3'}`}>{STATUS_LABEL[s]}</span>
);

/** The workbook's calculations that became KPI formulas on the main table's own columns. */
export function kpisFor(calcs: Calc[], columns: string[]): KpiDefinition[] {
  const byLower = new Map(columns.map(c => [c.toLowerCase(), c]));
  const out: KpiDefinition[] = [];
  for (const c of calcs) {
    if (!c.kpi) continue;
    let ok = true;
    const formula = c.kpi.replace(/\[([^\]]+)\]/g, (_, name: string) => {
      const real = byLower.get(name.toLowerCase());
      if (!real) ok = false;
      return `[${real ?? name}]`;
    });
    if (!ok) continue;
    const format = /%|rate|ratio|share|pct|percent/i.test(c.name) ? 'percent' : /revenue|sales|profit|cost|price|amount|\$/i.test(c.name) ? 'currency' : 'number';
    out.push({ id: `bi-${out.length}-${c.name.replace(/\W+/g, '-').toLowerCase()}`, name: c.name, formula, format });
  }
  return out;
}

/** Sends the design to the dashboard until it says it applied it (it may still be opening). */
function sendDesign(detail: unknown): Promise<boolean> {
  return new Promise(resolve => {
    let tries = 0;
    const done = () => { clearInterval(timer); window.removeEventListener(DASHBOARD_APPLIED_EVENT, done); resolve(true); };
    window.addEventListener(DASHBOARD_APPLIED_EVENT, done);
    const send = () => {
      if (++tries > 40) { clearInterval(timer); window.removeEventListener(DASHBOARD_APPLIED_EVENT, done); resolve(false); return; }
      window.dispatchEvent(new CustomEvent(DASHBOARD_APPLY_EVENT, { detail }));
    };
    const timer = setInterval(send, 500);
    send();
  });
}

/** Imports a Tableau (.twbx, .twb, .hyper) or Power BI (.pbix) file: its data, and its sheets as a studio dashboard. */
export default function BiImport({ onImported }: { onImported?: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const studio = useContext(StudioDataContext);
  const [state, setState] = useState<{ phase: 'idle' | 'working' | 'done' | 'error'; message?: string; result?: BiResult }>({ phase: 'idle' });
  const [building, setBuilding] = useState<string | null>(null);

  const upload = async (file: File) => {
    setState({ phase: 'working', message: `Reading ${file.name}` });
    setBuilding(null);
    try {
      const r = await engine.importWorkbook(file, undefined, { onProgress: (_p, m) => setState(s => ({ ...s, message: m || s.message })) });
      setState({ phase: 'done', result: r as unknown as BiResult });
      onImported?.();
    } catch (err) {
      setState({ phase: 'error', message: (err as Error)?.message || 'The import failed.' });
    }
  };

  const build = async (r: BiResult) => {
    if (!studio || !r.dataset) return;
    setBuilding('Opening the data');
    try {
      const ds = await loadEngineDataset(r.dataset.id, r.dataset.name, r.dataset.rows);
      studio.open(ds);
      window.dispatchEvent(new CustomEvent(OPEN_STEP_EVENT, { detail: { step: 'dashboard' } }));
      setBuilding('Building the dashboard');
      const kpis = kpisFor(r.calculations, ds.columns.map(c => c.name));
      const ok = await sendDesign({ design: r.design ?? undefined, kpis });
      setBuilding(ok ? 'Done' : 'The dashboard didn’t answer; open the Dashboard step and try again.');
    } catch (err) {
      setBuilding((err as Error)?.message || 'Could not open the data.');
    }
  };

  const r = state.result;
  const product = r ? (r.product === 'tableau' ? 'Tableau' : 'Power BI') : '';
  return (
    <div className="card p-4 sm:p-5 space-y-3" data-agent="area-bi-import">
      <div>
        <h3 className="card-title flex items-center gap-2"><PackageOpen className="w-4 h-4" /> From Tableau or Power BI</h3>
        <p className="mt-1 text-sm text-label-2">
          A packaged Tableau workbook (.twbx), a Tableau extract (.hyper) or a Power BI file (.pbix). Its data comes in as tables,
          its sheets are rebuilt as studio charts where there's a match, and its calculations become KPIs where they can be.
          A .twb holds no data, so only its design is read.
        </p>
      </div>
      <input ref={input} type="file" accept=".twbx,.twb,.hyper,.pbix" className="hidden" data-agent="bi-file"
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
      <button type="button" className="btn btn-secondary" disabled={state.phase === 'working'} onClick={() => input.current?.click()}>
        {state.phase === 'working' ? <><Orb state="connecting" label="Importing" /> {state.message}</> : 'Choose a workbook'}
      </button>
      {state.phase === 'error' && <p className="text-sm text-red" role="alert">{state.message}</p>}

      {state.phase === 'done' && r && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="chip">{product} · {r.file}</span>
            <span className="chip">{r.summary.tables} {r.summary.tables === 1 ? 'table' : 'tables'}</span>
            <span className="chip">{r.summary.sheetsConverted + r.summary.sheetsApproximated} of {r.summary.sheets} sheets rebuilt</span>
            <span className="chip">{r.summary.calculationsConverted} of {r.summary.calculations} calculations as KPIs</span>
          </div>

          {r.dataset && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn btn-primary" data-agent="bi-build" disabled={!!building && building !== 'Done' && !/try again|Could not/.test(building)} onClick={() => build(r)}>
                <LayoutDashboard className="w-4 h-4" /> Open and build the dashboard
              </button>
              {building && <span className="text-sm text-label-2" role="status">{building}</span>}
            </div>
          )}

          {r.sheets.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-sm font-semibold text-label">Sheets</h4>
              <DataTable rows={r.sheets as any[]} limit={50} columns={[
                { key: 'name', label: 'Sheet' },
                { key: 'chart', label: 'Studio chart', format: (v: any) => v ?? '—' },
                { key: 'status', label: 'Status', format: (v: any) => statusChip(v) },
                { key: 'note', label: 'Note', format: (v: any) => v ?? '' },
              ]} />
            </div>
          )}

          {r.calculations.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-sm font-semibold text-label">Calculations</h4>
              <DataTable rows={r.calculations as any[]} limit={50} columns={[
                { key: 'name', label: 'Name' },
                { key: 'formula', label: `${product} formula`, format: (v: any) => <code className="text-xs break-all">{String(v)}</code> },
                { key: 'kpi', label: 'KPI formula', format: (v: any) => (v ? <code className="text-xs break-all">{String(v)}</code> : '—') },
                { key: 'status', label: 'Status', format: (v: any) => statusChip(v) },
              ]} />
            </div>
          )}

          {r.datasets.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-sm font-semibold text-label">Tables</h4>
              <ul className="divide-y divide-separator">
                {r.datasets.map(d => (
                  <li key={d.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-label truncate">{d.name}</p>
                      <p className="text-xs text-label-3">{d.rows.toLocaleString()} rows × {d.columns.length} columns{d.id === r.dataset?.id ? ' · the dashboard uses this one' : ''}</p>
                    </div>
                    <UseEngineDataset dataset={d} mode="open" label="Open" />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!!r.notes?.length && (
            <ul className="text-sm text-label-2 list-disc pl-5 space-y-1">
              {r.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
