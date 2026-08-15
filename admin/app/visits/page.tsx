import { AdminPage } from '@/app/components/admin-page';
import { requireAdmin } from '@/lib/auth';
import { getRecentVisits } from '@/lib/cloudbase-visits';
import { VisitsPageView } from './visits-page-view';

export default async function VisitsPage() {
  await requireAdmin();
  const result = await getRecentVisits();

  return (
    <AdminPage
      title="访问记录"
      description={result.ok ? `最近 ${result.rows.length} 条定位访问记录` : '定位访问记录'}
    >
      <VisitsPageView error={result.error} rows={result.rows} />
    </AdminPage>
  );
}
