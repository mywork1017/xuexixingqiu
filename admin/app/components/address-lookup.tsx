'use client';

import { useState } from 'react';

type Result = { name: string; address: string; latitude: number; longitude: number };

export function AddressLookup({ initialQuery, onSelect }: { initialQuery: string; onSelect?: (result: Result) => void }) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Result[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function search() {
    setBusy(true); setMessage('');
    const response = await fetch(`/api/admin/geocode?q=${encodeURIComponent(query)}`);
    const payload = await response.json();
    setResults(payload.results || []);
    if (!payload.results?.length) setMessage(payload.error || '暂未搜到结果，可以继续手动填写坐标');
    setBusy(false);
  }

  function useResult(result: Result) {
    onSelect?.(result);
    const form = document.querySelector<HTMLFormElement>('[data-review-form], [data-place-form]');
    const set = (name: string, value: string) => {
      const input = form?.elements.namedItem(name) as HTMLInputElement | null;
      if (input) { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }
    };
    if (!onSelect) set('address', result.address);
    set('latitude', String(result.latitude)); set('longitude', String(result.longitude));
    setMessage('已填入地址和坐标'); setResults([]);
  }

  return <section className="address-lookup">
    <div className="lookup-row"><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入名称、地址或区域" /><button className="button secondary" type="button" disabled={busy || !query.trim()} onClick={search}>{busy ? '搜索中…' : '免费搜索位置'}</button></div>
    {results.length ? <div className="lookup-results">{results.map((result) => <button type="button" key={`${result.latitude}-${result.longitude}`} onClick={() => useResult(result)}><strong>{result.name}</strong><span>{result.address}</span></button>)}</div> : null}
    {message ? <p className="muted">{message}</p> : null}
  </section>;
}
