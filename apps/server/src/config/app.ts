export const production = process.env.NODE_ENV === 'production';
const configuredOrigin = process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL;
if (production && !configuredOrigin) throw new Error('APP_ORIGIN or RENDER_EXTERNAL_URL is required in production');
const url = new URL(configuredOrigin ?? 'http://localhost:5173');
if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
  throw new Error('APP_ORIGIN must be an HTTP(S) origin without path or credentials');
}
if (production && url.protocol !== 'https:') throw new Error('Production APP_ORIGIN must use HTTPS');
export const appOrigin = url.origin;
