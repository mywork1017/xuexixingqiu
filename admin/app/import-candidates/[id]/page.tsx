import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { CATEGORY_OPTIONS } from '@/lib/place-shape';
import { reviewCandidate } from '../actions';
import { AddressLookup } from '@/app/components/address-lookup';

function Field({ label, current, incoming, name, multiline = false }: { label: string; current?: string; incoming?: string; name: string; multiline?: boolean }) {
  return <div className="compare-field"><span className="field-label">{label}</span><div className="current-value"><small>当前数据</small>{current || '暂无'}</div><label><small>审核后内容</small>{multiline ? <textarea className="textarea" name={name} defaultValue={incoming || current || ''} /> : <input className="input" name={name} defaultValue={incoming || current || ''} />}</label></div>;
}

export default async function CandidateReviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const candidate = await prisma.importCandidate.findUnique({ where: { id } });
  if (!candidate) notFound();
  const current = candidate.matchedPlaceId ? await prisma.place.findUnique({ where: { id: candidate.matchedPlaceId } }) : null;
  const possibleCandidate = !current ? await prisma.importCandidate.findFirst({
    where: { id: { not: candidate.id }, OR: [{ name: candidate.name }, ...(candidate.address ? [{ address: candidate.address }] : [])] },
    orderBy: { updatedAt: 'desc' }
  }) : null;

  return <main className="shell">
    <header className="topbar"><div><div className="eyebrow">{candidate.source}</div><h1 className="brand">审核候选地点</h1></div><Link className="button secondary" href="/import-candidates">返回候选列表</Link></header>
    <form action={reviewCandidate} className="review-form" data-review-form>
      <input type="hidden" name="id" value={candidate.id} />
      <section className="panel compare-list">
        <AddressLookup initialQuery={[candidate.name, candidate.address].filter(Boolean).join(' ')} />
        <Field label="名称" name="name" current={current?.name} incoming={candidate.name} />
        <div className="compare-field"><span className="field-label">分类</span><div className="current-value"><small>当前数据</small>{current?.category || '暂无'}</div><label><small>审核后内容</small><select className="select" name="category" defaultValue={candidate.category || current?.category || '图书馆'}>{CATEGORY_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></label></div>
        <Field label="地址" name="address" current={current?.address} incoming={candidate.address} />
        <Field label="营业时间" name="hours" current={current?.hours} incoming={candidate.hours} />
        <Field label="设施" name="facilities" current={current?.facilities} incoming={candidate.facilities} multiline />
        <Field label="简介" name="description" current={current?.description} incoming={candidate.description} multiline />
        <Field label="纬度" name="latitude" current={current?.latitude ? String(current.latitude) : ''} incoming={candidate.latitude ? String(candidate.latitude) : ''} />
        <Field label="经度" name="longitude" current={current?.longitude ? String(current.longitude) : ''} incoming={candidate.longitude ? String(candidate.longitude) : ''} />
      </section>
      <section className="review-meta"><span>来源：<a className="text-link" href={candidate.sourceUrl} target="_blank">查看原始页面</a></span>{current ? <span>将合并到：<Link className="text-link" href={`/places/${current.id}`}>{current.name}</Link></span> : <span>将创建新地点</span>}{possibleCandidate ? <span>发现同名或同地址候选：<Link className="text-link" href={`/import-candidates/${possibleCandidate.id}`}>{possibleCandidate.name}（{possibleCandidate.source}）</Link></span> : null}</section>
      <div className="sticky-actions"><button className="button danger" type="submit" name="decision" value="ignored">忽略</button><button className="button secondary" type="submit" name="decision" value="draft">保存为草稿</button><button className="button" type="submit" name="decision" value="published">审核并发布</button></div>
    </form>
  </main>;
}
