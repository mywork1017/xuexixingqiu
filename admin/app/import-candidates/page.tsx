import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { approveAllCandidates, runImport } from './actions';

export default async function ImportCandidatesPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string; source?: string; created?: string; updated?: string; approved?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const status = params.status || 'pending';
  const candidates = await prisma.importCandidate.findMany({
    where: status === 'all' ? undefined : { reviewStatus: status },
    orderBy: { updatedAt: 'desc' }, take: 300
  });
  const counts = await prisma.importCandidate.groupBy({ by: ['reviewStatus'], _count: true });
  const count = (key: string) => counts.find((item) => item.reviewStatus === key)?._count || 0;
  const duplicateCounts = new Map<string, number>();
  for (const candidate of candidates) {
    const key = `${candidate.name.trim().toLowerCase()}|${candidate.address.trim().toLowerCase()}`;
    duplicateCounts.set(key, (duplicateCounts.get(key) || 0) + 1);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div><div className="eyebrow">数据工作台</div><h1 className="brand">地点抓取与审核</h1></div>
        <Link className="button secondary" href="/places">地点管理</Link>
      </header>
      <section className="source-grid">
        <form action={runImport} className="source-card">
          <input type="hidden" name="source" value="official" />
          <strong>上海市文旅局名录</strong>
          <span className="muted">名称、地址、营业时间与备注</span>
          <button className="button" type="submit">抓取官方名录</button>
        </form>
        <form action={runImport} className="source-card">
          <input type="hidden" name="source" value="osm" />
          <strong>OpenStreetMap</strong>
          <span className="muted">补充公开地图中的图书馆与坐标</span>
          <button className="button secondary" type="submit">抓取地图地点</button>
        </form>
      </section>
      {params.created !== undefined ? <p className="notice">抓取完成：新增 {params.created} 条，更新 {params.updated || 0} 条。</p> : null}
      {params.approved !== undefined ? <p className="notice">已批量同意 {params.approved} 条候选。</p> : null}
      <nav className="status-tabs" aria-label="审核状态">
        <Link className={status === 'pending' ? 'active' : ''} href="/import-candidates?status=pending">待审核 {count('pending')}</Link>
        <Link className={status === 'approved' ? 'active' : ''} href="/import-candidates?status=approved">已采用 {count('approved')}</Link>
        <Link className={status === 'ignored' ? 'active' : ''} href="/import-candidates?status=ignored">已忽略 {count('ignored')}</Link>
        <Link className={status === 'all' ? 'active' : ''} href="/import-candidates?status=all">全部</Link>
      </nav>
      {status === 'pending' && count('pending') > 0 ? <form action={approveAllCandidates} className="batch-actions"><button className="button" type="submit">批量同意全部 {count('pending')} 条</button></form> : null}
      <section className="panel table-wrap">
        <table className="table">
          <thead><tr><th>名称</th><th>来源</th><th>地址</th><th>匹配</th><th>状态</th><th></th></tr></thead>
          <tbody>
            {candidates.map((candidate) => <tr key={candidate.id}>
              <td><Link href={`/import-candidates/${candidate.id}`}>{candidate.name}</Link></td>
              <td>{candidate.source}</td><td className="muted">{candidate.address || '待补充'}</td>
              <td>{candidate.matchedPlaceId || (duplicateCounts.get(`${candidate.name.trim().toLowerCase()}|${candidate.address.trim().toLowerCase()}`) || 0) > 1 ? <span className="badge warning">疑似已有</span> : <span className="badge">新地点</span>}</td>
              <td>{candidate.reviewStatus}</td><td><Link className="text-link" href={`/import-candidates/${candidate.id}`}>审核</Link></td>
            </tr>)}
          </tbody>
        </table>
        {!candidates.length ? <div className="empty-state">当前没有候选地点</div> : null}
      </section>
    </main>
  );
}
