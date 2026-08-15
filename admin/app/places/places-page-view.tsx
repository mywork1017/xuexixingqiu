'use client';

import { CloudUploadOutlined, DownloadOutlined } from '@ant-design/icons';
import { Alert, Button, Space } from 'antd';
import { AdminPage } from '@/app/components/admin-page';
import { PlacesFilters, PlacesTable } from './places-client';

type PlaceRow = {
  id: string;
  name: string;
  category: string;
  address: string;
  hours: string;
  description: string;
  pushState: 'pushed' | 'unpushed';
};

export function PlacesPageView({
  rows,
  filters,
  sync,
  pushed,
  deleted,
  pushAction
}: {
  rows: PlaceRow[];
  filters: { q: string; category: string; status: string };
  sync?: string;
  pushed?: string;
  deleted?: string;
  pushAction: () => void;
}) {
  return (
    <AdminPage
      title="地点管理"
      description={`查阅和调整现有地点数据，共 ${rows.length} 个筛选结果`}
      actions={(
        <Space wrap>
          <Button href="/api/admin/places/export" icon={<DownloadOutlined />}>导出 CSV 备份</Button>
          <form action={pushAction}>
            <Button htmlType="submit" icon={<CloudUploadOutlined />}>推送到小程序</Button>
          </form>
        </Space>
      )}
    >
      <div className="notice-stack">
        {sync === 'success' ? (
          <Alert
            showIcon
            type="success"
            title={`已推送 ${pushed || 0} 个地点，清理 ${deleted || 0} 个小程序旧地点`}
          />
        ) : null}
        {sync === 'missing' ? <Alert showIcon type="warning" title="服务器尚未配置微信云环境凭证" /> : null}
        {sync === 'failed' ? <Alert showIcon type="error" title="推送失败，请检查服务器日志和云环境配置" /> : null}
      </div>
      <PlacesFilters initialValues={filters} />
      <PlacesTable rows={rows} />
    </AdminPage>
  );
}
