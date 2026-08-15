'use client';

import { EyeOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Card, Empty, Form, Input, Select, Table, Tag, Typography } from 'antd';
import type { TableProps } from 'antd';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { CATEGORY_OPTIONS } from '@/lib/place-shape';

type PlaceRow = {
  id: string;
  name: string;
  category: string;
  address: string;
  hours: string;
  description: string;
  pushState: 'pushed' | 'unpushed';
};

const statusColors: Record<string, string> = {
  pushed: 'success',
  unpushed: 'default'
};

const statusLabels: Record<string, string> = {
  pushed: '已推送到小程序',
  unpushed: '未推送到小程序'
};

export function PlacesFilters({
  initialValues
}: {
  initialValues: { q: string; category: string; status: string };
}) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function filter(values: { q?: string; category?: string; status?: string }, delay = 0) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const params = new URLSearchParams();
      if (values.q?.trim()) params.set('q', values.q.trim());
      if (values.category && values.category !== 'all') params.set('category', values.category);
      if (values.status && values.status !== 'all') params.set('status', values.status);
      router.replace(`/places${params.size ? `?${params}` : ''}`);
    }, delay);
  }

  return (
    <Card className="filter-card">
      <Form
        initialValues={initialValues}
        onValuesChange={(changed, values) => filter(values, Object.hasOwn(changed, 'q') ? 300 : 0)}
      >
        <div className="filter-grid">
          <Form.Item name="q" noStyle>
            <Input allowClear prefix={<SearchOutlined />} placeholder="搜索地点名称" />
          </Form.Item>
          <Form.Item name="category" noStyle>
            <Select
              options={[
                { label: '全部分类', value: 'all' },
                ...CATEGORY_OPTIONS.map((item) => ({ label: item, value: item }))
              ]}
            />
          </Form.Item>
          <Form.Item name="status" noStyle>
            <Select
              options={[
                { label: '全部状态', value: 'all' },
                { label: statusLabels.pushed, value: 'pushed' },
                { label: statusLabels.unpushed, value: 'unpushed' }
              ]}
            />
          </Form.Item>
        </div>
      </Form>
    </Card>
  );
}

export function PlacesTable({ rows }: { rows: PlaceRow[] }) {
  const columns: TableProps<PlaceRow>['columns'] = [
    {
      title: '名称',
      dataIndex: 'name',
      fixed: 'left',
      width: 160,
      render: (name, row) => <Typography.Link href={`/places/${row.id}`}>{name}</Typography.Link>
    },
    { title: '分类', dataIndex: 'category', width: 100 },
    { title: '地址', dataIndex: 'address', ellipsis: true, width: 210 },
    {
      title: '时间',
      dataIndex: 'hours',
      ellipsis: true,
      width: 150,
      render: (value) => value || <Typography.Text type="secondary">-</Typography.Text>
    },
    {
      title: '简介',
      dataIndex: 'description',
      ellipsis: true,
      width: 160,
      render: (value) => value || <Typography.Text type="secondary">-</Typography.Text>
    },
    {
      title: '状态',
      dataIndex: 'pushState',
      width: 130,
      render: (value) => (
        <Tag color={statusColors[value]}>
          {statusLabels[value]}
        </Tag>
      )
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 110,
      render: (_, row) => (
        <Button href={`/places/${row.id}`} icon={<EyeOutlined />} type="link">查看编辑</Button>
      )
    }
  ];

  return (
    <Card className="content-card" styles={{ body: { padding: 0 } }}>
      <Table
        columns={columns}
        dataSource={rows}
        locale={{ emptyText: <Empty description="当前没有地点" /> }}
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `共 ${total} 个地点` }}
        rowKey="id"
        scroll={{ x: 1020 }}
      />
    </Card>
  );
}
