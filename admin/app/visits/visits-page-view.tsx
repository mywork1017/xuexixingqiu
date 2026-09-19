'use client';

import { DeleteOutlined, EditOutlined, SearchOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, DatePicker, Input, Modal, Select, Space, Table, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { useMemo, useState } from 'react';
import type { VisitQueryResult, VisitRow } from '@/lib/cloudbase-visits';
import { deleteVisit, saveVisitorName } from './actions';

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

function locationValue(row: VisitRow) {
  return `${row.nation}\u0000${row.province}\u0000${row.city}\u0000${row.district}`;
}

function locationLabel(row: VisitRow) {
  return [row.nation && row.nation !== '中国' ? row.nation : '', row.province, row.city, row.district]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(' / ') || '待解析';
}

export function VisitsPageView({
  rows,
  error
}: {
  rows: VisitRow[];
  error?: VisitQueryResult['error'];
}) {
  const { message, modal } = App.useApp();
  const [visitRows, setVisitRows] = useState(rows);
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState<string>();
  const [visitor, setVisitor] = useState<string>();
  const [timeRange, setTimeRange] = useState<[number, number] | null>(null);
  const [datePickerKey, setDatePickerKey] = useState(0);
  const [visitorEditor, setVisitorEditor] = useState<{ code: string; name: string } | null>(null);
  const [savingVisitorName, setSavingVisitorName] = useState(false);

  const locationOptions = useMemo(() => Array.from(
    new Map(visitRows.map((row) => [locationValue(row), locationLabel(row)])).entries()
  ).map(([value, label]) => ({ value, label })), [visitRows]);

  const visitorOptions = useMemo(() => Array.from(new Map(
    visitRows
      .filter((row) => row.visitorCode)
      .map((row) => [row.visitorCode, row.visitorName || `访客 ${row.visitorCode}`])
  ).entries()).sort((left, right) => left[1].localeCompare(right[1], 'zh-CN'))
    .map(([value, label]) => ({ value, label })), [visitRows]);

  const filteredRows = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('zh-CN');
    return visitRows.filter((row) => {
      if (location && locationValue(row) !== location) return false;
      if (visitor && row.visitorCode !== visitor) return false;
      const visitedAt = new Date(row.createdAt).getTime();
      if (timeRange && (!Number.isFinite(visitedAt) || visitedAt < timeRange[0] || visitedAt > timeRange[1])) {
        return false;
      }
      if (!keyword) return true;
      return [
        row.visitorName,
        row.visitorCode,
        row.nation,
        row.province,
        row.city,
        row.district,
        row.street,
        row.placeName,
        row.address
      ]
        .some((value) => value.toLocaleLowerCase('zh-CN').includes(keyword));
    });
  }, [location, query, timeRange, visitRows, visitor]);

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
      width: 180,
      render: (_value: string, row) => row.visitorCode ? (
        <Space orientation="vertical" size={0}>
          <Button
            icon={<EditOutlined />}
            onClick={() => setVisitorEditor({ code: row.visitorCode, name: row.visitorName })}
            type="link"
          >
            {row.visitorName || `访客 ${row.visitorCode}`}
          </Button>
          {row.visitorName ? <Typography.Text type="secondary">访客 {row.visitorCode}</Typography.Text> : null}
        </Space>
      ) : '匿名访客'
    },
    {
      title: '城市',
      dataIndex: 'city',
      width: 180,
      render: (_value: string, row) => {
        const parts = [
          row.nation && row.nation !== '中国' ? row.nation : '',
          row.province && row.province !== row.city ? row.province : '',
          row.city
        ].filter(Boolean);
        return parts.join(' / ') || '待解析';
      }
    },
    {
      title: '区县',
      dataIndex: 'district',
      width: 120,
      render: (value: string) => value || '待解析'
    },
    {
      title: '小区/地标',
      dataIndex: 'placeName',
      width: 180,
      render: (value: string, row) => value || row.address || '—'
    },
    {
      title: '街道',
      dataIndex: 'street',
      width: 180,
      render: (value: string) => value || '—'
    },
    {
      title: '定位精度',
      dataIndex: 'accuracy',
      width: 120,
      render: (value: number | null) => value === null ? '—' : `约 ${value} 米`
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 90,
      render: (_value, row) => (
        <Button
          danger
          icon={<DeleteOutlined />}
          onClick={() => {
            modal.confirm({
              title: '删除这条访问记录？',
              content: '删除后无法恢复。',
              okText: '删除',
              okButtonProps: { danger: true },
              cancelText: '取消',
              onOk: async () => {
                try {
                  const result = await deleteVisit(row.id);
                  if (!result.ok) {
                    message.error(result.error);
                    return;
                  }
                  setVisitRows((current) => current.filter((item) => item.id !== row.id));
                  message.success('访问记录已删除');
                } catch {
                  message.error('访问记录删除失败');
                }
              }
            });
          }}
          type="link"
        >
          删除
        </Button>
      )
    }
  ];

  const hasFilters = Boolean(query.trim() || location || visitor || timeRange);

  function resetFilters() {
    setQuery('');
    setLocation(undefined);
    setVisitor(undefined);
    setTimeRange(null);
    setDatePickerKey((value) => value + 1);
  }

  if (error === 'missing-config') {
    return <Alert showIcon type="warning" title="服务器尚未配置微信云环境凭证" />;
  }
  if (error === 'query-failed') {
    return <Alert showIcon type="error" title="访问记录读取失败，请检查云数据库集合和服务器日志" />;
  }

  return (
    <>
      <Card className="filter-card">
        <div className="visit-filter-grid">
          <Input
            allowClear
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索访客名字、编号、城市、区县、小区或街道"
            prefix={<SearchOutlined />}
            value={query}
          />
          <Select
            allowClear
            onChange={setLocation}
            optionFilterProp="label"
            options={locationOptions}
            placeholder="全部地点"
            showSearch
            value={location}
          />
          <Select
            allowClear
            onChange={setVisitor}
            optionFilterProp="label"
            options={visitorOptions}
            placeholder="全部访客"
            showSearch
            value={visitor}
          />
          <DatePicker.RangePicker
            allowClear
            format="YYYY-MM-DD"
            key={datePickerKey}
            onChange={(dates) => {
              if (!dates || !dates[0] || !dates[1]) {
                setTimeRange(null);
                return;
              }
              setTimeRange([
                dates[0].startOf('day').valueOf(),
                dates[1].endOf('day').valueOf()
              ]);
            }}
            placeholder={['开始日期', '结束日期']}
          />
          <Button disabled={!hasFilters} onClick={resetFilters}>重置</Button>
        </div>
      </Card>
      <Card className="content-card" styles={{ body: { padding: 0 } }}>
        <Table
          columns={columns}
          dataSource={filteredRows}
          locale={{ emptyText: hasFilters ? '没有符合条件的访问记录' : '暂无访问记录' }}
          pagination={{
            pageSize: 50,
            showSizeChanger: false,
            showTotal: (total) => hasFilters ? `筛选出 ${total} 条，共 ${visitRows.length} 条` : `共 ${total} 条`
          }}
          rowKey="id"
          scroll={{ x: 1200 }}
        />
      </Card>
      <Modal
        cancelText="取消"
        confirmLoading={savingVisitorName}
        destroyOnHidden
        okText="保存"
        onCancel={() => setVisitorEditor(null)}
        onOk={async () => {
          if (!visitorEditor) return;
          setSavingVisitorName(true);
          try {
            const result = await saveVisitorName(visitorEditor.code, visitorEditor.name);
            if (!result.ok) {
              message.error(result.error);
              return;
            }
            setVisitRows((current) => current.map((row) => (
              row.visitorCode === visitorEditor.code ? { ...row, visitorName: result.name } : row
            )));
            setVisitorEditor(null);
            message.success(result.name ? '访客名字已更新' : '访客名字已清除');
          } catch {
            message.error('访客名字保存失败');
          } finally {
            setSavingVisitorName(false);
          }
        }}
        open={Boolean(visitorEditor)}
        title="修改访客名字"
      >
        <Input
          allowClear
          autoFocus
          maxLength={30}
          onChange={(event) => setVisitorEditor((current) => (
            current ? { ...current, name: event.target.value } : current
          ))}
          placeholder="输入访客名字，留空可恢复匿名编号"
          showCount
          value={visitorEditor?.name || ''}
        />
      </Modal>
    </>
  );
}
