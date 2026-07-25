import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { CATEGORY_OPTIONS, REVIEW_STATUS_OPTIONS } from '@/lib/place-shape';
import { pushPublishedPlaces } from './actions';

export default async function PlacesPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string; category?: string; status?: string; sync?: string; pushed?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const q = params.q || '';
  const category = params.category || '';
  const status = params.status || '';
  const places = await prisma.place.findMany({
    where: {
      name: q ? { contains: q } : undefined,
      category: category || undefined,
      reviewStatus: status || undefined
    },
    orderBy: { updatedAt: 'desc' },
    include: { photos: { orderBy: { sortOrder: 'asc' } } }
  });

  return (
    <main className="shell">
      <header className="topbar">
        <div><div className="eyebrow">上海学习地图后台</div><h1 className="brand">地点管理</h1></div>
        <div className="topbar-actions">
          <Link className="button secondary" href="/import-candidates">抓取与审核</Link>
          <a className="button secondary" href="/api/admin/places/export">导出 JSON</a>
          <form action={pushPublishedPlaces}><button className="button secondary" type="submit">推送到小程序</button></form>
          <Link className="button" href="/places/new">新增地点</Link>
        </div>
      </header>
      {params.sync === 'success' ? <p className="notice">已向小程序推送 {params.pushed || 0} 个已发布地点。</p> : null}
      {params.sync === 'missing' ? <p className="notice error">服务器尚未配置微信云环境凭证。</p> : null}
      {params.sync === 'failed' ? <p className="notice error">推送失败，请检查服务器日志和云环境配置。</p> : null}
      <section className="panel table-wrap">
        <form className="toolbar">
          <input className="input" name="q" placeholder="搜索名称" defaultValue={q} />
          <select className="select" name="category" defaultValue={category}>
            <option value="">全部分类</option>
            {CATEGORY_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select className="select" name="status" defaultValue={status}>
            <option value="">全部状态</option>
            {REVIEW_STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <button className="button" type="submit">筛选</button>
        </form>
        <table className="table">
          <thead>
            <tr>
              <th>名称</th>
              <th>分类</th>
              <th>地址</th>
              <th>照片</th>
              <th>设施</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {places.map((place) => (
              <tr key={place.id}>
                <td><Link href={`/places/${place.id}`}>{place.name}</Link></td>
                <td>{place.category}</td>
                <td className="muted">{place.address}</td>
                <td>{place.photos.length}</td>
                <td className="muted">{place.facilities || '待补充'}</td>
                <td>{REVIEW_STATUS_OPTIONS.find((item) => item.value === place.reviewStatus)?.label || place.reviewStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!places.length ? <div className="empty-state">当前没有地点，点击“新增地点”或前往“抓取与审核”。</div> : null}
      </section>
    </main>
  );
}
