import * as http from 'http';
import { URL } from 'url';
import { MovyProvider } from './provider';

const PORT = parseInt(process.env.PORT || '7000', 10);
const provider = new MovyProvider();

const MANIFEST = {
  id: 'org.cinestream.movysx',
  version: '1.0.0',
  name: 'Movy.sx Streams',
  description: 'High-speed direct HLS stream provider (4K / 1080p) from movy.sx / wecollege',
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

  // Root or health check
  if (pathname === '/' || pathname === '/health') {
    return sendJson(res, 200, {
      status: 'ok',
      service: 'Movy.sx Stremio Addon',
      version: MANIFEST.version,
      manifest: '/manifest.json',
    });
  }

  // Stremio Addon Manifest
  if (pathname === '/manifest.json') {
    return sendJson(res, 200, MANIFEST);
  }

  // Stremio Stream request: /stream/:type/:id.json
  const streamMatch = /^\/stream\/(movie|series)\/([^/]+)\.json$/i.exec(pathname);
  if (streamMatch) {
    const type = streamMatch[1].toLowerCase() as 'movie' | 'series';
    const rawId = decodeURIComponent(streamMatch[2]);

    try {
      console.log(`[Stream Request] Type: ${type}, ID: ${rawId}`);
      const streams = await provider.getStreams(type, rawId);
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
  console.log(`👉 Manifest URL: http://localhost:${PORT}/manifest.json`);
  console.log(`🔗 Ready to connect into AIOStreams`);
  console.log(`====================================================`);
});
