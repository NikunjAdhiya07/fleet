/**
 * BunnyCDN Storage helper.
 *
 * Required env vars:
 *   BUNNY_STORAGE_API_KEY   – Access key for the storage zone
 *   BUNNY_STORAGE_ZONE      – Storage zone name
 *   BUNNY_STORAGE_HOSTNAME  – e.g. storage.bunnycdn.com  (or regional: ny.storage.bunnycdn.com)
 *   BUNNY_CDN_URL           – Pull-zone URL, e.g. https://yourzone.b-cdn.net
 */

export async function uploadToBunny(
  path: string,
  buffer: Buffer,
  contentType = 'image/jpeg'
): Promise<{ cdnUrl: string; storagePath: string }> {
  const apiKey = process.env.BUNNY_STORAGE_API_KEY;
  const zone = process.env.BUNNY_STORAGE_ZONE;
  const hostname = process.env.BUNNY_STORAGE_HOSTNAME || 'storage.bunnycdn.com';
  const cdnBase = (process.env.BUNNY_CDN_URL || '').replace(/\/+$/, '');

  if (!apiKey || !zone) {
    throw new Error('BunnyCDN not configured — set BUNNY_STORAGE_API_KEY and BUNNY_STORAGE_ZONE');
  }

  const url = `https://${hostname}/${zone}/${path}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      AccessKey: apiKey,
      'Content-Type': contentType,
    },
    body: new Uint8Array(buffer),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`BunnyCDN upload failed: HTTP ${res.status} — ${body}`);
  }

  const cdnUrl = cdnBase ? `${cdnBase}/${path}` : `https://${hostname}/${zone}/${path}`;
  return { cdnUrl, storagePath: path };
}
