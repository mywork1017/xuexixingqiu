'use client';

import { LeftOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import { AdminPage } from '@/app/components/admin-page';
import { PlaceEditor } from './place-editor';

type PlaceValue = {
  id: string;
  name: string;
  category: string;
  address: string;
  hours: string;
  description: string;
  photos: string[];
};

export function PlaceEditorPageView({
  place
}: {
  place: PlaceValue;
}) {
  return (
    <AdminPage
      title="编辑地点"
      description={`调整 ${place.name} 的现有字段与照片`}
      actions={<Button href="/places" icon={<LeftOutlined />}>返回列表</Button>}
    >
      <PlaceEditor place={place} />
    </AdminPage>
  );
}
