'use client';

import { DeleteOutlined, UploadOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Form,
  Image,
  Input,
  Select,
  Typography,
  Upload
} from 'antd';
import { useState } from 'react';
import { CATEGORY_OPTIONS } from '@/lib/place-shape';
import { savePlace } from './actions';

const MAX_PHOTOS = 5;

type PlaceValue = {
  id: string;
  name: string;
  category: string;
  address: string;
  hours: string;
  description: string;
  photos: string[];
};

export function PlaceEditor({ place }: { place: PlaceValue }) {
  const [values, setValues] = useState({
    name: place.name || '',
    address: place.address || '',
    hours: place.hours || '',
    description: place.description || ''
  });
  const [category, setCategory] = useState(place.category || '图书馆');
  const [photos, setPhotos] = useState(place.photos || []);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');
  const [uploadBusy, setUploadBusy] = useState(false);

  function setField(field: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function uploadPhoto(file: File) {
    if (photos.length >= MAX_PHOTOS) {
      setMessageType('error');
      setMessage(`每个地点最多 ${MAX_PHOTOS} 张照片`);
      return;
    }
    setUploadBusy(true);
    setMessage('');
    const body = new FormData();
    body.append('image', file);
    const response = await fetch('/api/admin/uploads', { method: 'POST', body });
    const payload = await response.json();
    if (payload.ok) {
      setPhotos((current) => [...current, payload.url]);
      setMessageType('success');
      setMessage('照片已添加');
    } else {
      setMessageType('error');
      setMessage(payload.error || '上传失败');
    }
    setUploadBusy(false);
  }

  return (
    <Card className="editor-main-card" title="地点信息">
      {message ? <Alert className="editor-alert" showIcon type={messageType} title={message} /> : null}
      <form action={savePlace} data-place-form>
          <input type="hidden" name="id" value={place.id} />
          <input type="hidden" name="category" value={category} />
          <input type="hidden" name="photos" value={photos.join('\n')} />
          <Form component="div" layout="vertical">
            <div className="form-grid">
              <Form.Item label="名称" required>
                <Input name="name" value={values.name} onChange={(event) => setField('name', event.target.value)} required />
              </Form.Item>
              <Form.Item label="分类" required>
                <Select
                  onChange={setCategory}
                  options={CATEGORY_OPTIONS.map((item) => ({ label: item, value: item }))}
                  value={category}
                />
              </Form.Item>
              <Form.Item className="full" label="地址" required>
                <Input
                  name="address"
                  placeholder="输入区、道路和门牌号"
                  required
                  value={values.address}
                  onChange={(event) => setField('address', event.target.value)}
                />
              </Form.Item>
              <Form.Item className="full" label="营业时间">
                <Input name="hours" value={values.hours} onChange={(event) => setField('hours', event.target.value)} />
              </Form.Item>
              <Form.Item className="full" label="简介">
                <Input.TextArea
                  name="description"
                  rows={4}
                  value={values.description}
                  onChange={(event) => setField('description', event.target.value)}
                  placeholder="例如：提供热水，设有厕所和电源插座"
                />
              </Form.Item>
              <Card
                className="full"
                size="small"
                title="地点照片"
                extra={<Typography.Text type="secondary">{photos.length}/{MAX_PHOTOS}</Typography.Text>}
              >
                <div className="photo-grid">
                  {photos.map((url, index) => (
                    <div className="photo-item" key={`${url}-${index}`}>
                      <Image alt={`地点照片 ${index + 1}`} preview src={url} />
                      <Button
                        className="photo-delete"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => setPhotos((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                        shape="circle"
                        type="primary"
                      />
                    </div>
                  ))}
                  {photos.length < MAX_PHOTOS ? (
                    <Upload
                      accept="image/jpeg,image/png,image/webp"
                      beforeUpload={(file) => {
                        void uploadPhoto(file);
                        return Upload.LIST_IGNORE;
                      }}
                      disabled={uploadBusy}
                      showUploadList={false}
                    >
                      <Button icon={<UploadOutlined />} loading={uploadBusy}>上传照片</Button>
                    </Upload>
                  ) : null}
                </div>
              </Card>
              <div className="full form-actions">
                <Button htmlType="submit" size="large" type="primary">保存修改</Button>
              </div>
            </div>
          </Form>
      </form>
    </Card>
  );
}
