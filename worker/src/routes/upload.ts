import type { Ctx, Env } from '../types';
import { authenticate } from './admin';
import { json } from '../lib/http';

/**
 * Admin-only multipart upload into the ALBUMS bucket, for objects past
 * wrangler's ~315 MB single-PUT ceiling. The documented R2 MPU pattern:
 *
 *   POST /admin/mpu?action=create&key=albums/slug/file.zip     -> { uploadId }
 *   PUT  /admin/mpu?action=part&key=...&uploadId=...&part=N    -> { etag }
 *   POST /admin/mpu?action=complete&key=...&uploadId=...        body: [{partNumber, etag}]
 *   POST /admin/mpu?action=abort&key=...&uploadId=...
 *
 * Same authentication as /admin/export (Access identity or bearer fallback).
 * Keys are confined to the albums/ prefix so this can never overwrite
 * backups/ or anything else the Worker writes for itself.
 */

const KEY_RE = /^albums\/[a-z0-9-]+\/[A-Za-z0-9._ -]+$/;

export async function handleMpu(req: Request, env: Env, ctx: Ctx): Promise<Response> {
  const auth = await authenticate(req, env, ctx);
  if ('error' in auth) return auth.error;

  const url = new URL(req.url);
  const action = url.searchParams.get('action') ?? '';
  const key = url.searchParams.get('key') ?? '';
  if (!KEY_RE.test(key)) return json({ error: 'bad_key' }, { status: 400 });

  switch (action) {
    case 'create': {
      const mpu = await env.ALBUMS.createMultipartUpload(key, {
        httpMetadata: { contentType: 'application/zip' },
      });
      return json({ uploadId: mpu.uploadId });
    }
    case 'part': {
      const uploadId = url.searchParams.get('uploadId') ?? '';
      const part = Number(url.searchParams.get('part') ?? '0');
      if (!uploadId || !Number.isInteger(part) || part < 1 || part > 10000 || !req.body) {
        return json({ error: 'bad_request' }, { status: 400 });
      }
      const mpu = env.ALBUMS.resumeMultipartUpload(key, uploadId);
      const uploaded = await mpu.uploadPart(part, req.body);
      return json({ partNumber: uploaded.partNumber, etag: uploaded.etag });
    }
    case 'complete': {
      const uploadId = url.searchParams.get('uploadId') ?? '';
      if (!uploadId) return json({ error: 'bad_request' }, { status: 400 });
      const parts = (await req.json()) as { partNumber: number; etag: string }[];
      if (!Array.isArray(parts) || parts.length === 0 || parts.length > 10000) {
        return json({ error: 'bad_request' }, { status: 400 });
      }
      const mpu = env.ALBUMS.resumeMultipartUpload(key, uploadId);
      const object = await mpu.complete(parts);
      return json({ key: object.key, size: object.size, etag: object.httpEtag });
    }
    case 'abort': {
      const uploadId = url.searchParams.get('uploadId') ?? '';
      if (!uploadId) return json({ error: 'bad_request' }, { status: 400 });
      await env.ALBUMS.resumeMultipartUpload(key, uploadId).abort();
      return json({ ok: true });
    }
    default:
      return json({ error: 'bad_action' }, { status: 400 });
  }
}
