'use client';

import { Alert, Card, Table, Tag } from 'antd';
import type { TableColumnsType } from 'antd';
import type { VisitQueryResult, VisitRow } from '@/lib/cloudbase-visits';

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

const columns: TableColumnsType<VisitRow> = [
  {
    title: '访问时间',
    dataIndex: 'createdAt',
    width: 150,
    render: (value: string) => value ? dateFormatter.format(new Date(value)) : '—'
  },
  {
    title: '访客',
    dataIndex: 'visitorCode',
    width: 130,
    render: (value: string) => value ? `访客 ${value}` : '匿名访客'
  },
  {
    title: '城市',
    dataIndex: 'city',
    width: 110,
    render: (value: string) => value || '待解析'
  },
  {
    title: '区县',
    dataIndex: 'district',
    width: 120,
    render: (value: string) => value || '待解析'
  },
  {
    title: '触发方式',
    dataIndex: 'source',
    width: 120,
    render: (value: VisitRow['source']) => (
      <Tag>{value === 'location_button' ? '定位按钮' : '打开地图'}</Tag>
    )
  },
  {
    title: '定位精度',
    dataIndex: 'accuracy',
    width: 120,
    render: (value: number | null) => value === null ? '—' : `约 ${value} 米`
  }
];

export function VisitsPageView({
  rows,
  error
}: {
  rows: VisitRow[];
  error?: VisitQueryResult['error'];
}) {
  if (error === 'missing-config') {
    return <Alert showIcon type="warning" title="服务器尚未配置微信云环境凭证" />;
  }
  if (error === 'query-failed') {
    return <Alert showIcon type="error" title="访问记录读取失败，请检查云数据库集合和服务器日志" />;
  }

  return (
    <Card className="content-card" styles={{ body: { padding: 0 } }}>
      <Table
        columns={columns}
        dataSource={rows}
        locale={{ emptyText: '暂无访问记录' }}
        pagination={{ pageSize: 50, showSizeChanger: false }}
        rowKey="id"
        scroll={{ x: 750 }}
      />
    </Card>
  );
}
