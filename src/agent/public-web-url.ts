import { isIP } from 'node:net';

export function isPublicWebUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8192 || !/^https?:\/\/[^/?#@]+(?:[/?#]|$)/i.test(value) || /[\s\\\x00-\x1f\x7f]/.test(value)) return false;
  try {
    const url = new URL(value), host = url.hostname.replace(/\.$/, '');
    return !url.username && !url.password && !isIP(host.replace(/^\[|\]$/g, ''))
      && /^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(host)
      && !/\.(?:local|localhost|localdomain|internal|lan|home|arpa|test|invalid|example|onion)$/i.test(host);
  } catch { return false; }
}
