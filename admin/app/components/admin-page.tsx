'use client';

import { LogoutOutlined } from '@ant-design/icons';
import { Button, Flex, Layout, Space, Typography } from 'antd';
import { usePathname } from 'next/navigation';
import { logout } from '@/app/login/actions';

const { Header, Content } = Layout;

export function AdminPage({
  title,
  description,
  actions,
  children
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <Layout className="admin-layout">
      <Header className="admin-header">
        <div className="admin-branding">
          <a className="admin-logo" href="/places">上海学习地图</a>
          <nav className="admin-nav" aria-label="后台功能">
            <a aria-current={pathname.startsWith('/places') ? 'page' : undefined} href="/places">地点管理</a>
            <a aria-current={pathname.startsWith('/visits') ? 'page' : undefined} href="/visits">访问记录</a>
          </nav>
        </div>
        <form action={logout} className="admin-logout">
          <Button htmlType="submit" icon={<LogoutOutlined />}>退出登录</Button>
        </form>
      </Header>
      <Content className="admin-content">
        <Flex className="page-heading" align="flex-start" justify="space-between" gap={16} wrap>
          <Space orientation="vertical" size={2}>
            <Typography.Title level={2}>{title}</Typography.Title>
            {description ? <Typography.Text type="secondary">{description}</Typography.Text> : null}
          </Space>
          {actions}
        </Flex>
        {children}
      </Content>
    </Layout>
  );
}
