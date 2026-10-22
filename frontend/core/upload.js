// core/upload.js — 上傳檔案到 S3（取代 Firebase Storage）
// 後端先檢查權限並簽一張 presigned POST，前端再直接傳給 S3，回傳公開網址。
import { apiFetch } from './api.js';

export async function uploadMedia(kind, blob, { groupId = null, contentType = blob.type } = {}) {
    const { res, data } = await apiFetch('/api/uploads/presign', {
        method: 'POST',
        body: JSON.stringify({ kind, content_type: contentType, group_id: groupId }),
    });
    if (!res.ok || data?.status !== 'success') throw new Error(data?.detail || `HTTP ${res.status}`);

    const form = new FormData();
    Object.entries(data.fields).forEach(([key, value]) => form.append(key, value));
    form.append('file', blob);  // file 必須是最後一個欄位
    const upload = await fetch(data.url, { method: 'POST', body: form });
    if (!upload.ok) throw new Error(`上傳失敗 (HTTP ${upload.status})`);
    return data.public_url;
}
