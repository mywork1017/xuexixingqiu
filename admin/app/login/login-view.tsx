'use client';

import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Input, Space, Typography } from 'antd';

export function LoginView({
  error,
  loginAction
}: {
  error: boolean;
  loginAction: (formData: FormData) => void;
}) {
  return (
    <main className="login-shell">
      <Card className="login-card">
        <Space orientation="vertical" size="large" style={{ width: '100%' }}>
          <Space orientation="vertical" size={2}>
            <Typography.Title level={3} style={{ margin: 0 }}>上海学习地图后台</Typography.Title>
            <Typography.Text type="secondary">使用管理员账号登录</Typography.Text>
          </Space>
          {error ? <Alert type="error" showIcon title="账号或密码不正确，请重试" /> : null}
          <form action={loginAction}>
            <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
              <Input
                autoComplete="username"
                name="username"
                prefix={<UserOutlined />}
                placeholder="账号"
                size="large"
                required
              />
              <Input.Password
                autoComplete="current-password"
                name="password"
                prefix={<LockOutlined />}
                placeholder="密码"
                size="large"
                required
              />
              <Button block htmlType="submit" size="large" type="primary">登录</Button>
            </Space>
          </form>
        </Space>
      </Card>
    </main>
  );
}
