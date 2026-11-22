/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, AlertTriangle, ExternalLink, Eye, EyeOff, KeyRound, Lock } from 'lucide-react';
import Orb from './Orb';
import AiModelUpdate, { type AiModelInfo } from './AiModelUpdate';
import { AI_KEY_HEADER, ARC_DASHBOARD_URL, cleanGeminiKey, getAiSource, getUserKeys, isArcKey, looksLikeGeminiKey, maskKey, setAiSource, setUserKey, type AiSource } from '../utils/aiKey';

type TestResult = { ok: boolean; message: string; reason?: string } | null;

async function testKey(key: string): Promise<TestResult> {
  try {
    const res = await fetch('/api/ai/test-key', { method: 'POST', headers: { 'Content-Type': 'application/json', [AI_KEY_HEADER]: key } });
    const body = await res.json().catch(() => null);
    return { ok: !!body?.ok, reason: body?.reason, message: body?.message || `The check failed (HTTP ${res.status}).` };
  } catch {
    return { ok: false, message: 'Could not reach the server to check the key.' };
  }
}

/** One optional key (ARC or Gemini): paste, save and test, or test again and remove. */
function KeySlot({ kind, onChanged }: { kind: 'arc' | 'gemini'; onChanged: () => void }) {
  const [saved, setSaved] = useState<string | null>(() => getUserKeys()[kind]);
  const [draft, setDraft] = useState('');
  const [reveal, setReveal] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult>(null);
  const clean = cleanGeminiKey(draft);
  const valid = kind === 'arc' ? isArcKey(clean) : looksLikeGeminiKey(clean) && !isArcKey(clean);
  const label = kind === 'arc' ? 'ARC key' : 'Gemini key';
  const id = `ai-key-${kind}`;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setTesting(true); setResult(null);
    const outcome = await testKey(clean);
    setTesting(false); setResult(outcome);
    // Save a key that works, or one that couldn't be checked only because the service
    // or the network was briefly unavailable. Never save a rejected key.
    if (outcome?.ok || outcome?.reason === 'busy' || outcome?.reason === 'network') {
      setUserKey(kind, clean); setSaved(clean); setDraft(''); onChanged();
    }
  };

  return (
    <div className="rounded-2xl bg-well p-4 space-y-2" data-agent={`ai-key-${kind}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-label">{label} <span className="font-normal text-label-3">· optional</span></p>
        <a href={kind === 'arc' ? ARC_DASHBOARD_URL : 'https://aistudio.google.com/app/apikey'} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue hover:underline">
          Get one <ExternalLink className="w-3 h-3" />
        </a>
      </div>
      <p className="text-xs text-label-2 leading-relaxed">
        {kind === 'arc'
          ? 'Your own ARC workspace: ARC picks a working model and falls back across the provider keys you add there (Gemini, Groq, OpenRouter…).'
          : 'A free key from Google AI Studio.'}
      </p>
      {saved ? (
        <div className="flex items-center justify-between gap-3">
          <p className="font-code text-sm text-label truncate">{maskKey(saved)}</p>
          <div className="flex gap-2 shrink-0">
            <button type="button" className="btn btn-sm btn-secondary" disabled={testing} aria-busy={testing}
              onClick={async () => { setTesting(true); setResult(null); setResult(await testKey(saved)); setTesting(false); }}>
              {testing ? <><Orb state="listening" label="Checking your key" /> Checking…</> : 'Test'}
            </button>
            <button type="button" className="btn btn-sm bg-red/10 text-red hover:bg-red/15" onClick={() => { setUserKey(kind, null); setSaved(null); setResult(null); onChanged(); }}>Remove</button>
          </div>
        </div>
      ) : (
        <form onSubmit={save} className="space-y-2">
          <label htmlFor={id} className="sr-only">{label}</label>
          <div className="relative">
            <input id={id} type={reveal ? 'text' : 'password'} value={draft} onChange={e => { setDraft(e.target.value); setResult(null); }}
              placeholder={kind === 'arc' ? 'ARC_DEE_…_PAK_…' : 'AIza… or AQ.…'} autoComplete="off" spellCheck={false} className="field pr-11 font-code text-[14px]" />
            <button type="button" onClick={() => setReveal(r => !r)} className="btn btn-icon w-8 h-8 absolute right-1.5 top-1/2 -translate-y-1/2" aria-label={reveal ? 'Hide key' : 'Show key'}>
              {reveal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {draft && !valid && (
            <p className="text-xs text-red">
              {kind === 'arc'
                ? (/^ARC_/.test(clean) ? 'That ARC key looks cut short. Copy it again from your app’s page in ARC.' : 'An ARC key starts with “ARC_DEE_”. A Gemini key goes in the box below.')
                : (isArcKey(clean) ? 'That’s an ARC key: put it in the ARC box above.' : 'That doesn’t look like a Gemini key (they usually start with “AIza” or “AQ.”).')}
            </p>
          )}
          <button type="submit" disabled={!valid || testing} aria-busy={testing} className="btn btn-primary w-full">
            {testing ? <><Orb state="listening" onAccent label="Checking your key" /> Checking…</> : 'Save and Test'}
          </button>
        </form>
      )}
      {result && (
        <p role="status" className={`flex items-start gap-2 text-xs ${result.ok ? 'text-green' : 'text-red'}`}>
          {result.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
          {result.message}
        </p>
      )}
    </div>
  );
}

/**
 * AI settings: which AI to use first (the studio's, through the keys saved on the
 * server — ARC, then Gemini — or the visitor's own keys), and the visitor's own
 * optional ARC and Gemini keys. Each side falls back to the other.
 */
export default function AiKeySheet({ onClose, onChanged, models }: { onClose: () => void; onChanged: () => void; models?: AiModelInfo }) {
  const [source, setSource] = useState<AiSource>(() => getAiSource());
  const [keys, setKeys] = useState(() => getUserKeys());
  const changed = () => { setKeys(getUserKeys()); onChanged(); };
  const hasOwn = !!(keys.arc || keys.gemini);

  // Close with Escape, like any system sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pick = (s: AiSource) => { setSource(s); setAiSource(s); onChanged(); };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} className="absolute inset-0 bg-[var(--scrim)]" />
      <motion.div
        role="dialog" aria-modal="true" aria-labelledby="ai-key-title"
        initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24, scale: 0.98 }}
        transition={{ duration: 0.3, ease: [0.28, 0.11, 0.32, 1] }}
        className="relative z-10 w-full sm:max-w-md bg-raised rounded-t-3xl sm:rounded-3xl shadow-xl p-6 sm:p-7 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-blue/12 text-blue flex items-center justify-center shrink-0"><KeyRound className="w-5 h-5" /></span>
            <h2 id="ai-key-title" className="text-xl font-semibold tracking-tight text-label">AI keys</h2>
          </div>
          <button type="button" onClick={onClose} className="btn btn-plain font-semibold -mr-2 -mt-1">Done</button>
        </div>

        <div className="mt-5 space-y-2">
          <p className="text-sm font-medium text-label">Use AI from</p>
          <div className="segmented w-full" role="group" aria-label="Use AI from" data-agent="ai-source">
            <button type="button" className="flex-1" aria-pressed={source === 'studio'} onClick={() => pick('studio')}>The studio</button>
            <button type="button" className="flex-1" aria-pressed={source === 'mine'} onClick={() => pick('mine')} disabled={!hasOwn} title={hasOwn ? undefined : 'Add a key of your own first'}>My own keys</button>
          </div>
          <p className="text-xs text-label-2 leading-relaxed">
            {source === 'mine' && hasOwn
              ? 'Your keys first (ARC, then Gemini). If they can’t answer, the studio’s AI takes over.'
              : 'The studio’s AI first, through the keys saved on its server (ARC, then Gemini).' + (hasOwn ? ' If it can’t answer, your own keys take over.' : ' Add a key of your own below to keep AI working when the studio’s runs out.')}
          </p>
        </div>

        <div className="mt-5 space-y-3">
          <KeySlot kind="arc" onChanged={changed} />
          <KeySlot kind="gemini" onChanged={changed} />
        </div>

        <div className="mt-5 pt-4 border-t border-separator space-y-1.5">
          <p className="text-sm font-medium text-label">Gemini model</p>
          <p className="text-xs text-label-2 leading-relaxed">Google retires models from time to time. The studio checks which ones exist and uses the newest on its own; press this if AI says a model isn’t available.</p>
          <AiModelUpdate models={models} onUpdated={onChanged} />
        </div>


        <p className="mt-4 pt-4 border-t border-separator flex items-start gap-2 text-xs text-label-3 leading-relaxed">
          <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Your keys are saved only in this browser. They’re sent with your AI requests and passed straight to ARC or
          Google — never stored or logged on the server. Anyone using this browser can use it, so remove it on
          shared computers.
        </p>
      </motion.div>
    </div>
  );
}
