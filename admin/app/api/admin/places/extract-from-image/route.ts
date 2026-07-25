import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';

const PROMPT = `你在整理上海学习地图地点资料。请从输入内容提取并整理：
- name 名称
- address 地址
- hours 营业或开放时间
- description 一段通顺、客观、可直接展示的中文简介
- facilities 一段自然语言设施说明，把开水、厕所、厕所类型、插座、Wi-Fi 等信息写在一起
只返回 JSON 对象。缺少的信息使用空字符串。不要编造。`;

function extractJson(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('识别结果格式不正确');
  return JSON.parse(match[0]);
}

export async function POST(request: Request) {
  await requireAdmin();
  const apiKey = process.env.IMAGE_EXTRACT_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: '先在 .env.local 配置 IMAGE_EXTRACT_API_KEY' }, { status: 400 });
  }

  const formData = await request.formData();
  const image = formData.get('image');
  const content = String(formData.get('content') || '').trim();
  if (!(image instanceof File) && !content) {
    return NextResponse.json({ ok: false, error: '请上传截图或粘贴内容' }, { status: 400 });
  }

  const inputContent: Array<Record<string, string>> = [{ type: 'input_text', text: `${PROMPT}\n\n用户粘贴内容：${content}` }];
  if (image instanceof File) {
    const base64 = Buffer.from(await image.arrayBuffer()).toString('base64');
    inputContent.push({ type: 'input_image', image_url: `data:${image.type};base64,${base64}` });
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.IMAGE_EXTRACT_MODEL || 'gpt-4.1-mini',
      input: [{ role: 'user', content: inputContent }],
      max_output_tokens: 1200
    })
  });
  if (!response.ok) {
    return NextResponse.json({ ok: false, error: `识别服务调用失败：${response.status}` }, { status: 502 });
  }
  const payload = await response.json();
  const outputText = payload.output_text || payload.output?.flatMap((item: { content?: Array<{ text?: string }> }) => item.content || []).map((item: { text?: string }) => item.text || '').join('') || '';
  try {
    return NextResponse.json({ ok: true, extracted: extractJson(outputText) });
  } catch {
    return NextResponse.json({ ok: false, error: '识别结果无法解析，请重试' }, { status: 502 });
  }
}
