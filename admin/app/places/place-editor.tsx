'use client';

import { useState } from 'react';
import {
  CATEGORY_OPTIONS,
  REVIEW_STATUS_OPTIONS
} from '@/lib/place-shape';
import { savePlace } from './actions';
import { AddressLookup } from '@/app/components/address-lookup';

type Extracted = {
  name?: string;
  address?: string;
  hours?: string;
  description?: string;
  facilities?: string;
};

type PlaceValue = {
  id?: string;
  name?: string;
  category?: string;
  address?: string;
  latitude?: number | string;
  longitude?: number | string;
  hours?: string;
  description?: string;
  facilities?: string;
  photos?: string[];
  source?: string;
  sourceUrl?: string;
  reviewStatus?: string;
};

export function PlaceEditor({ place }: { place: PlaceValue }) {
  const [values, setValues] = useState({
    name: place.name || '', address: place.address || '', hours: place.hours || '',
    description: place.description || '', facilities: place.facilities || ''
  });
  const [photos, setPhotos] = useState(place.photos || []);
  const [content, setContent] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  function setField(field: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function uploadPhoto(file: File) {
    if (photos.length >= 5) return setMessage('每个地点最多 5 张照片');
    setBusy(true); setMessage('');
    const body = new FormData(); body.append('image', file);
    const response = await fetch('/api/admin/uploads', { method: 'POST', body });
    const payload = await response.json();
    if (payload.ok) setPhotos((current) => [...current, payload.url]);
    else setMessage(payload.error || '上传失败');
    setBusy(false);
  }

  async function extract() {
    setBusy(true); setMessage('');
    const body = new FormData();
    if (image) body.append('image', image);
    if (content) body.append('content', content);
    const response = await fetch('/api/admin/places/extract-from-image', { method: 'POST', body });
    const payload = await response.json();
    if (payload.ok) {
      setExtracted(payload.extracted);
      setSelected(Object.fromEntries(Object.keys(payload.extracted).map((key) => [key, Boolean(payload.extracted[key])])));
    } else setMessage(payload.error || '整理失败');
    setBusy(false);
  }

  function applyExtracted() {
    if (!extracted) return;
    setValues((current) => {
      const next = { ...current };
      for (const key of Object.keys(next) as Array<keyof typeof next>) {
        const value = extracted[key];
        if (selected[key] && typeof value === 'string' && value) next[key] = value;
      }
      return next;
    });
    setMessage('已填入所选字段，请检查后保存');
  }

  const extractedLabels: Record<string, string> = {
    name: '名称', address: '地址', hours: '营业时间', description: '简介', facilities: '设施'
  };

  return (
    <div className="editor-layout">
      <form action={savePlace} className="form-grid" data-place-form>
        <input type="hidden" name="id" value={place.id || ''} />
        <label>名称<input className="input" name="name" value={values.name} onChange={(event) => setField('name', event.target.value)} required /></label>
        <label>分类<select className="select" name="category" defaultValue={place.category || '图书馆'}>{CATEGORY_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="full">地址<input className="input" name="address" value={values.address} onChange={(event) => setField('address', event.target.value)} /></label>
        <div className="full"><AddressLookup initialQuery={[values.name, values.address].filter(Boolean).join(' ')} onSelect={(result) => setField('address', result.address)} /></div>
        <label>纬度<input className="input" name="latitude" defaultValue={place.latitude ?? ''} inputMode="decimal" required /></label>
        <label>经度<input className="input" name="longitude" defaultValue={place.longitude ?? ''} inputMode="decimal" required /></label>
        <label className="full">营业时间<input className="input" name="hours" value={values.hours} onChange={(event) => setField('hours', event.target.value)} /></label>
        <label>状态<select className="select" name="reviewStatus" defaultValue={place.reviewStatus || 'draft'}>{REVIEW_STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="full">设施<textarea className="textarea" name="facilities" value={values.facilities} onChange={(event) => setField('facilities', event.target.value)} placeholder="例如：提供开水，有厕所，厕所为蹲坑，设有充电插座" /></label>
        <label className="full">简介<textarea className="textarea" name="description" value={values.description} onChange={(event) => setField('description', event.target.value)} /></label>
        <label>来源<input className="input" name="source" defaultValue={place.source || 'admin'} /></label>
        <label className="full">来源链接<input className="input" name="sourceUrl" defaultValue={place.sourceUrl || ''} /></label>
        <input type="hidden" name="photos" value={photos.join('\n')} />
        <section className="full subpanel">
          <div className="section-heading"><strong>地点照片</strong><span className="muted">{photos.length}/5</span></div>
          <div className="photo-grid">
            {photos.map((url, index) => <div className="photo-item" key={`${url}-${index}`}><img src={url} alt={`地点照片 ${index + 1}`} /><button type="button" className="icon-button" onClick={() => setPhotos((current) => current.filter((_, itemIndex) => itemIndex !== index))}>删除</button></div>)}
            {photos.length < 5 ? <label className="upload-tile">上传照片<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={(event) => event.target.files?.[0] && uploadPhoto(event.target.files[0])} /></label> : null}
          </div>
        </section>
        <div className="full action-row"><button className="button" type="submit">保存地点</button></div>
      </form>

      <aside className="assistant-panel">
        <div className="section-heading"><strong>截图与内容整理</strong></div>
        <p className="muted">上传截图或粘贴一段内容，整理后选择要填入的字段。</p>
        <textarea className="textarea" value={content} onChange={(event) => setContent(event.target.value)} placeholder="粘贴介绍、营业时间或设施信息" />
        <label className="file-picker">选择截图<input type="file" accept="image/*" onChange={(event) => setImage(event.target.files?.[0] || null)} /></label>
        <button className="button full-button" type="button" disabled={busy || (!image && !content)} onClick={extract}>{busy ? '处理中…' : '识别并整理'}</button>
        {extracted ? <div className="extract-results">{Object.entries(extractedLabels).map(([key, label]) => extracted[key as keyof Extracted] ? <label className="extract-row" key={key}><input type="checkbox" checked={Boolean(selected[key])} onChange={(event) => setSelected((current) => ({ ...current, [key]: event.target.checked }))} /><span><strong>{label}</strong><small>{extracted[key as keyof Extracted]}</small></span></label> : null)}<button className="button secondary full-button" type="button" onClick={applyExtracted}>填入所选字段</button></div> : null}
        {message ? <p className="notice">{message}</p> : null}
      </aside>
    </div>
  );
}
