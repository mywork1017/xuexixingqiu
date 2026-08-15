import './globals.css';
import { AntdProvider } from './components/antd-provider';

export const metadata = {
  title: '上海学习地图后台',
  description: '地点管理后台'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body><AntdProvider>{children}</AntdProvider></body>
    </html>
  );
}
