export function sanitizePlaceDescription(value: string) {
  const source = String(value || '').replace(/\s+/g, ' ').trim();
  return source.replace(/[。！？；;，,.!?]+$/g, '');
}
