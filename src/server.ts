import * as http from 'http';
import { URL } from 'url';
import { Readable } from 'stream';
import { MovyProvider } from './provider';
import { HlsAccelerator } from './hls-accelerator';
import { fetchUpstream } from './upstream';

const PORT = parseInt(process.env.PORT || '7000', 10);
const ACCESS_KEY = (process.env.ACCESS_KEY || '').trim();
const provider = new MovyProvider();
const accelerator = new HlsAccelerator();

const MANIFEST = {
  id: 'org.cinestream.movysx',
  version: '1.0.0',
  name: 'Movy',
  description: 'Movy',
  resources: ['stream'],
  types: ['movie', 'series'],
  idPrefixes: ['tt', 'tmdb:'],
  catalogs: [],
  behaviorHints: {
    configurable: false,
    configurationRequired: false,
  },
};

function sendJson(res: http.ServerResponse, status: number, data: any) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'max-age=1800, public',
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Split and inspect path segments
  const rawSegments = pathname.split('/').filter(Boolean);
  const cleanSegments = [...rawSegments];

  // Strip leading 'movy' or 'stremio' prefix if present
  if (cleanSegments[0]?.toLowerCase() === 'movy' || cleanSegments[0]?.toLowerCase() === 'stremio') {
    cleanSegments.shift();
  }

  // Extract access key from query param, header, or URL path
  let providedKey =
    parsedUrl.searchParams.get('k') ||
    parsedUrl.searchParams.get('key') ||
    parsedUrl.searchParams.get('token') ||
    (req.headers['x-access-key'] as string | undefined) ||
    '';

  if (!providedKey && req.headers['authorization']) {
    const authHeader = req.headers['authorization'];
    if (authHeader.startsWith('Bearer ')) {
      providedKey = authHeader.substring(7).trim();
    }
  }

  // Check if first path segment matches the ACCESS_KEY
  if (ACCESS_KEY && cleanSegments.length > 0) {
    const seg = cleanSegments[0];
    if (seg === ACCESS_KEY || decodeURIComponent(seg) === ACCESS_KEY) {
      providedKey = ACCESS_KEY;
      cleanSegments.shift();
      // Handle optional 'movy' / 'stremio' prefix after key (e.g. /<key>/movy/manifest.json)
      if (cleanSegments[0]?.toLowerCase() === 'movy' || cleanSegments[0]?.toLowerCase() === 'stremio') {
        cleanSegments.shift();
      }
    }
  }

  const normalizedPath = '/' + cleanSegments.join('/');

  // Reject unauthorized requests if ACCESS_KEY is configured
  if (ACCESS_KEY && providedKey !== ACCESS_KEY) {
    return sendJson(res, 401, {
      error: 'Unauthorized',
      message: 'A valid secret access key is required to use this addon.',
    });
  }

  // Root or health check
  if (normalizedPath === '/' || normalizedPath === '/health') {
    const keyPrefix = ACCESS_KEY ? `/${ACCESS_KEY}` : '';
    return sendJson(res, 200, {
      status: 'ok',
      service: 'Movy.sx Stremio Addon',
      version: MANIFEST.version,
      manifest: `${keyPrefix}/manifest.json`,
      authenticated: !!ACCESS_KEY,
    });
  }

  // Stremio Addon Manifest
  if (normalizedPath === '/manifest.json') {
    return sendJson(res, 200, MANIFEST);
  }

  // Debug diagnostic endpoint
  if (normalizedPath === '/debug') {
    const testId = parsedUrl.searchParams.get('id') || 'tt1375666';
    const testType = (parsedUrl.searchParams.get('type') || 'movie') as 'movie' | 'series';
    const diagnostics: any = {
      timestamp: new Date().toISOString(),
      testId,
      testType,
      nodeVersion: process.version,
    };

    // 1. Test db.wecollege.net
    try {
      const metaRes = await fetchUpstream(`https://db.wecollege.net/3/find/${testId}?external_source=imdb_id`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Origin': 'https://www.movy.sx',
          'Referer': 'https://www.movy.sx/',
        },
      });
      diagnostics.metadataFetch = {
        status: metaRes.status,
        statusText: metaRes.statusText,
        ok: metaRes.ok,
      };
      if (metaRes.ok) {
        diagnostics.metadataJson = await metaRes.json();
      } else {
        diagnostics.metadataBody = await metaRes.text();
      }
    } catch (err: any) {
      diagnostics.metadataError = err.message || String(err);
    }

    // 2. Test api.wecollege.net/seed
    try {
      const seedRes = await fetchUpstream(`https://api.wecollege.net/seed?mediaId=27205`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Origin': 'https://www.movy.sx',
          'Referer': 'https://www.movy.sx/',
        },
      });
      diagnostics.seedFetch = {
        status: seedRes.status,
        statusText: seedRes.statusText,
        ok: seedRes.ok,
      };
      if (seedRes.ok) {
        diagnostics.seedJson = await seedRes.json();
      } else {
        diagnostics.seedBody = await seedRes.text();
      }
    } catch (err: any) {
      diagnostics.seedError = err.message || String(err);
    }

    // 3. Test full getStreams
    try {
      const streams = await provider.getStreams(testType, testId, `http://localhost:${PORT}`);
      diagnostics.streamsCount = streams.length;
      diagnostics.firstStream = streams[0] || null;
    } catch (err: any) {
      diagnostics.streamsError = err.message || String(err);
    }

    return sendJson(res, 200, diagnostics);
  }

  // HLS Stream & Segment Proxy Endpoint with Multi-Stream Accelerator
  if (normalizedPath.startsWith('/proxy/hls')) {
    const encoded = parsedUrl.searchParams.get('d');
    if (!encoded) {
      res.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      return res.end('Missing d parameter');
    }

    let targetUrl: string;
    try {
      targetUrl = Buffer.from(encoded, 'base64url').toString('utf8');
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      return res.end('Invalid encoding');
    }

    const isM3u8 = targetUrl.includes('.m3u8') || normalizedPath.endsWith('.m3u8');
    const rangeHeader = req.headers['range'] as string | undefined;

    // Fast-path: Check HLS Multi-Stream Accelerator Cache for video segments (.m4s, .ts)
    if (!isM3u8) {
      const cached = await accelerator.getSegment(targetUrl, rangeHeader);
      if (cached) {
        res.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Content-Type': cached.contentType || 'video/mp4',
          'Content-Length': cached.data.byteLength,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=3600',
        });
        return res.end(cached.data);
      }
    }

    const upstreamHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Origin': 'https://www.movy.sx',
      'Referer': 'https://www.movy.sx/',
    };

    if (rangeHeader) {
      upstreamHeaders['Range'] = rangeHeader;
    }

    try {
      const upstreamRes = await fetchUpstream(targetUrl, { headers: upstreamHeaders });
      if (!upstreamRes.ok && upstreamRes.status !== 206) {
        console.warn(`[HLS Proxy Warning] Upstream returned ${upstreamRes.status} for ${targetUrl}`);
        res.writeHead(upstreamRes.status, { 'Access-Control-Allow-Origin': '*' });
        return res.end();
      }

      const contentType = (upstreamRes.headers['content-type'] as string) || '';
      const checkM3u8 = isM3u8 || contentType.includes('mpegurl');

      if (checkM3u8) {
        const text = await upstreamRes.text();
        const proto = (req.headers['x-forwarded-proto'] as string) || ((req.socket as any).encrypted ? 'https' : 'http');
        const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || `localhost:${PORT}`;
        const keyPrefix = ACCESS_KEY ? `/${ACCESS_KEY}` : '';
        const proxyBase = `${proto}://${host}${keyPrefix}`;
        const keyQuery = ACCESS_KEY ? `&k=${encodeURIComponent(ACCESS_KEY)}` : '';

        // If this is a media playlist with segment chunks, register for multi-stream prefetching
        if (text.includes('#EXTINF:')) {
          const segmentUrls: string[] = [];
          for (const l of text.split('\n')) {
            const t = l.trim();
            if (t && !t.startsWith('#')) {
              const abs = new URL(t, targetUrl).toString();
              segmentUrls.push(abs);
            }
          }
          accelerator.registerPlaylist(targetUrl, segmentUrls);
        }

        const rewritten = text.split('\n').map(line => {
          const trimmed = line.trim();
          if (!trimmed) return line;

          if (trimmed.startsWith('#EXT-X-MAP:URI=')) {
            const match = trimmed.match(/#EXT-X-MAP:URI="([^"]+)"/);
            if (match) {
              const absUri = new URL(match[1], targetUrl).toString();
              const enc = Buffer.from(absUri, 'utf8').toString('base64url');
              return `#EXT-X-MAP:URI="${proxyBase}/proxy/hls/init.mp4?d=${enc}${keyQuery}"`;
            }
            return line;
          }

          if (trimmed.startsWith('#')) return line;

          const absUrl = new URL(trimmed, targetUrl).toString();

          // Sub-playlists must always be proxied with .m3u8 extension for ExoPlayer
          if (absUrl.includes('.m3u8')) {
            const enc = Buffer.from(absUrl, 'utf8').toString('base64url');
            return `${proxyBase}/proxy/hls/stream.m3u8?d=${enc}${keyQuery}`;
          }

          // Route media segments through the multi-connection accelerator proxy
          const enc = Buffer.from(absUrl, 'utf8').toString('base64url');
          const segExt = absUrl.includes('.m4s') ? 'seg.m4s' : 'seg.ts';
          return `${proxyBase}/proxy/hls/${segExt}?d=${enc}${keyQuery}`;
        }).join('\n');

        res.writeHead(200, {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Cache-Control': 'no-cache',
        });
        return res.end(rewritten);
      }

      // Stream media segment directly from upstream if not in accelerator cache
      const resHeaders: Record<string, string | number> = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Content-Type': contentType || 'video/mp4',
      };

      const cl = upstreamRes.headers['content-length'];
      if (cl) resHeaders['Content-Length'] = cl;
      const cr = upstreamRes.headers['content-range'];
      if (cr) resHeaders['Content-Range'] = cr;
      const ar = upstreamRes.headers['accept-ranges'];
      if (ar) resHeaders['Accept-Ranges'] = ar;

      res.writeHead(upstreamRes.status, resHeaders);

      res.on('close', () => {
        upstreamRes.stream.destroy();
      });

      upstreamRes.stream.pipe(res);
      return;
    } catch (err: any) {
      console.error('[HLS Proxy Error]', err);
      res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
      return res.end('Proxy Error');
    }
  }

  // Stremio Stream request: /stream/:type/:id.json
  const streamMatch = /^\/stream\/(movie|series)\/([^/]+)\.json$/i.exec(normalizedPath);
  if (streamMatch) {
    const type = streamMatch[1].toLowerCase() as 'movie' | 'series';
    const rawId = decodeURIComponent(streamMatch[2]);

    try {
      console.log(`[Stream Request] Type: ${type}, ID: ${rawId}`);
      const proto = (req.headers['x-forwarded-proto'] as string) || ((req.socket as any).encrypted ? 'https' : 'http');
      const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || `localhost:${PORT}`;
      const keyPrefix = ACCESS_KEY ? `/${ACCESS_KEY}` : '';
      const baseUrl = `${proto}://${host}${keyPrefix}`;

      const streams = await provider.getStreams(type, rawId, baseUrl, ACCESS_KEY);
      console.log(`[Stream Response] Found ${streams.length} stream(s) for ${rawId}`);
      return sendJson(res, 200, { streams });
    } catch (err: any) {
      console.error(`[Stream Error] ${rawId}:`, err);
      return sendJson(res, 200, { streams: [] });
    }
  }

  // 404
  sendJson(res, 404, { error: 'Not Found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 Movy.sx Stremio Addon Server running on port ${PORT}`);
  console.log(`⚡ HLS Multi-Stream Accelerator: Active (4 concurrent prefetch streams)`);
  if (ACCESS_KEY) {
    console.log(`🔒 Secret Access Token: Enabled`);
    console.log(`👉 Protected Manifest URL: http://localhost:${PORT}/${ACCESS_KEY}/manifest.json`);
  } else {
    console.log(`🔓 Secret Access Token: Disabled (Public mode)`);
    console.log(`👉 Open Manifest URL: http://localhost:${PORT}/manifest.json`);
  }
  console.log(`🔗 Ready to connect into Stremio`);
  console.log(`====================================================`);
});
