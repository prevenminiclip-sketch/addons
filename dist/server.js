"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const http = __importStar(require("http"));
const url_1 = require("url");
const providers_1 = require("./providers");
const metadata_1 = require("./metadata");
const hls_accelerator_1 = require("./hls-accelerator");
const upstream_1 = require("./upstream");
const diagnostics_ui_1 = require("./diagnostics-ui");
const PORT = parseInt(process.env.PORT || '7000', 10);
const ACCESS_KEY = (process.env.ACCESS_KEY || '').trim();
const providerManager = new providers_1.ProviderManager();
const accelerator = new hls_accelerator_1.HlsAccelerator();
const MANIFESTS = {
    all: {
        id: 'org.cinestream.all',
        version: '1.2.1',
        name: 'Movy (All Providers)',
        description: 'Combined direct HLS streams from Movy, Hexa 4K, MovieBox, and Rivestream',
        resources: ['stream'],
        types: ['movie', 'series'],
        idPrefixes: ['tt', 'tmdb:'],
        catalogs: [],
        behaviorHints: { configurable: false, configurationRequired: false },
    },
    movy: {
        id: 'org.cinestream.movysx',
        version: '1.2.1',
        name: 'Movy',
        description: 'Direct HLS streams from Movy & WeCollege edge clusters',
        resources: ['stream'],
        types: ['movie', 'series'],
        idPrefixes: ['tt', 'tmdb:'],
        catalogs: [],
        behaviorHints: { configurable: false, configurationRequired: false },
    },
    hexa: {
        id: 'org.cinestream.hexa',
        version: '1.2.1',
        name: 'Hexa (4K)',
        description: 'Direct 4K HLS Master streams with multi-audio Dolby Atmos / 5.1',
        resources: ['stream'],
        types: ['movie', 'series'],
        idPrefixes: ['tt', 'tmdb:'],
        catalogs: [],
        behaviorHints: { configurable: false, configurationRequired: false },
    },
    moviebox: {
        id: 'org.cinestream.moviebox',
        version: '1.2.1',
        name: 'MovieBox',
        description: 'Direct streams from MovieBox, Vidrock, CinemaOS, and StreamingUnity',
        resources: ['stream'],
        types: ['movie', 'series'],
        idPrefixes: ['tt', 'tmdb:'],
        catalogs: [],
        behaviorHints: { configurable: false, configurationRequired: false },
    },
    rivestream: {
        id: 'org.cinestream.rivestream',
        version: '1.2.1',
        name: 'Rivestream',
        description: 'Direct signed Akamai CloudFront CDN streams',
        resources: ['stream'],
        types: ['movie', 'series'],
        idPrefixes: ['tt', 'tmdb:'],
        catalogs: [],
        behaviorHints: { configurable: false, configurationRequired: false },
    },
};
function sendJson(res, status, data) {
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
function sendHtml(res, status, html) {
    res.writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(html),
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
    });
    res.end(html);
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
    const parsedUrl = new url_1.URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    // Split and inspect path segments
    const rawSegments = pathname.split('/').filter(Boolean);
    const cleanSegments = [...rawSegments];
    // Extract access key from query param, header, or URL path
    let providedKey = parsedUrl.searchParams.get('k') ||
        parsedUrl.searchParams.get('key') ||
        parsedUrl.searchParams.get('token') ||
        req.headers['x-access-key'] ||
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
        }
    }
    // Identify modular provider prefix: 'movy', 'hexa', 'moviebox', 'rivestream', 'all', 'stremio'
    let providerFilter = 'all';
    const KNOWN_PROVIDERS = ['movy', 'hexa', 'moviebox', 'rivestream', 'all'];
    if (cleanSegments.length > 0) {
        const firstSeg = cleanSegments[0].toLowerCase();
        if (KNOWN_PROVIDERS.includes(firstSeg)) {
            providerFilter = firstSeg;
            cleanSegments.shift();
        }
        else if (firstSeg === 'stremio') {
            cleanSegments.shift();
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
        const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
        const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
        const keyPrefix = ACCESS_KEY ? `/${ACCESS_KEY}` : '';
        const base = `${proto}://${host}${keyPrefix}`;
        return sendJson(res, 200, {
            status: 'ok',
            service: 'Movy Modular Stremio Addon Server',
            version: '1.2.1',
            description: 'Individual providers as separate Stremio tabs or All-in-One combined',
            stremioTabs: {
                movy: `${base}/movy/manifest.json`,
                hexa: `${base}/hexa/manifest.json`,
                moviebox: `${base}/moviebox/manifest.json`,
                rivestream: `${base}/rivestream/manifest.json`,
                allCombined: `${base}/manifest.json`,
            },
            diagnosticsDashboard: `${base}/debug`,
            authenticated: !!ACCESS_KEY,
        });
    }
    // Stremio Addon Manifest
    if (normalizedPath === '/manifest.json') {
        const manifest = MANIFESTS[providerFilter] || MANIFESTS.all;
        return sendJson(res, 200, manifest);
    }
    // Debug & Diagnostics suite (Web Dashboard & JSON API)
    if (normalizedPath === '/debug' ||
        normalizedPath === '/diagnostics' ||
        normalizedPath === '/debug/probe' ||
        normalizedPath === '/probe') {
        const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
        const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
        const keyPrefix = ACCESS_KEY ? `/${ACCESS_KEY}` : '';
        const baseUrl = `${proto}://${host}${keyPrefix}`;
        const testId = parsedUrl.searchParams.get('id') || 'tt1375666';
        const testType = (parsedUrl.searchParams.get('type') || (testId.includes(':') ? 'series' : 'movie'));
        const rawProbeUrl = parsedUrl.searchParams.get('probeUrl') || parsedUrl.searchParams.get('url') || '';
        const probeD = parsedUrl.searchParams.get('d') || '';
        const format = (parsedUrl.searchParams.get('format') || '').toLowerCase();
        const wantsJson = format === 'json' || req.headers['accept']?.includes('application/json');
        let probeTarget = rawProbeUrl.trim();
        let probeRef = parsedUrl.searchParams.get('ref') || undefined;
        // Decode proxy URL or 'd' parameter if supplied
        if (!probeTarget && probeD) {
            try {
                probeTarget = Buffer.from(probeD, 'base64url').toString('utf8');
            }
            catch { }
        }
        else if (probeTarget.includes('/proxy/hls')) {
            try {
                const u = new url_1.URL(probeTarget, baseUrl);
                const dParam = u.searchParams.get('d');
                if (dParam) {
                    probeTarget = Buffer.from(dParam, 'base64url').toString('utf8');
                }
                const refParam = u.searchParams.get('ref');
                if (refParam) {
                    probeRef = Buffer.from(refParam, 'base64url').toString('utf8');
                }
            }
            catch { }
        }
        try {
            const target = (0, metadata_1.parseStremioId)(testType, testId);
            const report = await providerManager.getDiagnostics(target, baseUrl, ACCESS_KEY, providerFilter);
            let probeReport = undefined;
            if (probeTarget) {
                probeReport = await providerManager.probeStream(probeTarget, probeRef);
            }
            if (wantsJson) {
                return sendJson(res, 200, {
                    report,
                    probeReport,
                });
            }
            const html = (0, diagnostics_ui_1.renderDiagnosticsHtml)({
                report,
                baseUrl,
                probeReport,
                targetId: testId,
                targetType: testType,
                activeProvider: providerFilter,
            });
            return sendHtml(res, 200, html);
        }
        catch (err) {
            if (wantsJson) {
                return sendJson(res, 500, { error: err.message || String(err) });
            }
            return sendHtml(res, 500, `<h1>Diagnostics Error</h1><p>${err.message || String(err)}</p>`);
        }
    }
    // HLS Stream & Segment Proxy Endpoint with Multi-Stream Accelerator
    if (normalizedPath.startsWith('/proxy/hls')) {
        const encoded = parsedUrl.searchParams.get('d');
        if (!encoded) {
            res.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
            return res.end('Missing d parameter');
        }
        let targetUrl;
        try {
            targetUrl = Buffer.from(encoded, 'base64url').toString('utf8');
        }
        catch {
            res.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
            return res.end('Invalid encoding');
        }
        const rawRef = parsedUrl.searchParams.get('ref');
        let customReferer;
        if (rawRef) {
            try {
                customReferer = Buffer.from(rawRef, 'base64url').toString('utf8');
            }
            catch {
                customReferer = rawRef;
            }
        }
        const isM3u8 = targetUrl.includes('.m3u8') || normalizedPath.endsWith('.m3u8');
        const rangeHeader = req.headers['range'];
        // Fast-path: Check HLS Multi-Stream Accelerator Cache for video segments (.m4s, .ts)
        if (!isM3u8) {
            const cached = await accelerator.getSegment(targetUrl, rangeHeader, customReferer);
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
        const upstreamHeaders = accelerator.getHeadersForUrl(targetUrl, customReferer);
        if (rangeHeader) {
            upstreamHeaders['Range'] = rangeHeader;
        }
        try {
            const upstreamRes = await (0, upstream_1.fetchUpstream)(targetUrl, { headers: upstreamHeaders });
            if (!upstreamRes.ok && upstreamRes.status !== 206) {
                console.warn(`[HLS Proxy Warning] Upstream returned ${upstreamRes.status} for ${targetUrl}`);
                res.writeHead(upstreamRes.status, { 'Access-Control-Allow-Origin': '*' });
                return res.end();
            }
            let contentType = upstreamRes.headers['content-type'] || '';
            const checkM3u8 = isM3u8 || contentType.includes('mpegurl');
            if (checkM3u8) {
                const text = await upstreamRes.text();
                const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
                const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
                const keyPrefix = ACCESS_KEY ? `/${ACCESS_KEY}` : '';
                const proxyBase = `${proto}://${host}${keyPrefix}`;
                const keyQuery = ACCESS_KEY ? `&k=${encodeURIComponent(ACCESS_KEY)}` : '';
                const refQuery = rawRef ? `&ref=${encodeURIComponent(rawRef)}` : '';
                const finalTargetUrl = upstreamRes.url || targetUrl;
                // If this is a media playlist with segment chunks, register for multi-stream prefetching
                if (text.includes('#EXTINF:')) {
                    const segmentUrls = [];
                    for (const l of text.split('\n')) {
                        const t = l.trim();
                        if (t && !t.startsWith('#')) {
                            try {
                                const abs = new url_1.URL(t, finalTargetUrl).toString();
                                segmentUrls.push(abs);
                            }
                            catch { }
                        }
                    }
                    if (segmentUrls.length > 0) {
                        accelerator.registerPlaylist(finalTargetUrl, segmentUrls);
                    }
                }
                const rewritten = text
                    .split('\n')
                    .map((line) => {
                    const trimmed = line.trim();
                    if (!trimmed)
                        return line;
                    // Handle HLS tag lines with embedded URIs (audio tracks, subtitles, keys, init segments)
                    if (trimmed.startsWith('#')) {
                        if (trimmed.includes('URI="')) {
                            return trimmed.replace(/URI="([^"]+)"/g, (_, rawUri) => {
                                try {
                                    const absUri = new url_1.URL(rawUri, finalTargetUrl).toString();
                                    const enc = Buffer.from(absUri, 'utf8').toString('base64url');
                                    if (absUri.includes('.m3u8')) {
                                        return `URI="${proxyBase}/proxy/hls/stream.m3u8?d=${enc}${refQuery}${keyQuery}"`;
                                    }
                                    else if (absUri.includes('.mp4') || absUri.includes('.m4s') || absUri.includes('init')) {
                                        return `URI="${proxyBase}/proxy/hls/init.mp4?d=${enc}${refQuery}${keyQuery}"`;
                                    }
                                    else if (absUri.includes('.key')) {
                                        return `URI="${proxyBase}/proxy/hls/key.bin?d=${enc}${refQuery}${keyQuery}"`;
                                    }
                                    return `URI="${proxyBase}/proxy/hls/seg.ts?d=${enc}${refQuery}${keyQuery}"`;
                                }
                                catch {
                                    return `URI="${rawUri}"`;
                                }
                            });
                        }
                        return line;
                    }
                    // Normal line (sub-playlist or segment chunk URL)
                    try {
                        const absUrl = new url_1.URL(trimmed, finalTargetUrl).toString();
                        const enc = Buffer.from(absUrl, 'utf8').toString('base64url');
                        // Sub-playlists must always be proxied with .m3u8 extension for ExoPlayer
                        if (absUrl.includes('.m3u8')) {
                            return `${proxyBase}/proxy/hls/stream.m3u8?d=${enc}${refQuery}${keyQuery}`;
                        }
                        // Route media segments through the multi-connection accelerator proxy
                        const segExt = absUrl.includes('.m4s') ? 'seg.m4s' : 'seg.ts';
                        return `${proxyBase}/proxy/hls/${segExt}?d=${enc}${refQuery}${keyQuery}`;
                    }
                    catch {
                        return line;
                    }
                })
                    .join('\n');
                res.writeHead(200, {
                    'Content-Type': 'application/vnd.apple.mpegurl',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                    'Cache-Control': 'no-cache',
                });
                return res.end(rewritten);
            }
            // Fix spoofed image content-types (e.g. image/png on SlowCloud)
            if (!contentType || contentType.includes('image') || contentType.includes('octet-stream')) {
                contentType = targetUrl.includes('.ts') ? 'video/mp2t' : 'video/mp4';
            }
            // Stream media segment directly from upstream if not in accelerator cache
            const resHeaders = {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
                'Content-Type': contentType,
            };
            const cl = upstreamRes.headers['content-length'];
            if (cl)
                resHeaders['Content-Length'] = cl;
            const cr = upstreamRes.headers['content-range'];
            if (cr)
                resHeaders['Content-Range'] = cr;
            const ar = upstreamRes.headers['accept-ranges'];
            if (ar)
                resHeaders['Accept-Ranges'] = ar;
            res.writeHead(upstreamRes.status, resHeaders);
            // Data stall watchdog: terminate dead/hanging sockets after 10s of inactivity
            let stallTimer = setTimeout(() => {
                console.warn(`[HLS Segment Stall] Upstream stalled for >10s on ${targetUrl}`);
                upstreamRes.stream.destroy();
                res.destroy();
            }, 10000);
            upstreamRes.stream.on('data', () => {
                clearTimeout(stallTimer);
                stallTimer = setTimeout(() => {
                    console.warn(`[HLS Segment Stall] Upstream stalled for >10s on ${targetUrl}`);
                    upstreamRes.stream.destroy();
                    res.destroy();
                }, 10000);
            });
            res.on('close', () => {
                clearTimeout(stallTimer);
                upstreamRes.stream.destroy();
            });
            upstreamRes.stream.on('error', (err) => {
                clearTimeout(stallTimer);
                console.error(`[HLS Segment Error] ${err?.message || err}`);
            });
            upstreamRes.stream.on('end', () => {
                clearTimeout(stallTimer);
            });
            upstreamRes.stream.pipe(res);
            return;
        }
        catch (err) {
            console.error('[HLS Proxy Error]', err);
            res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
            return res.end('Proxy Error');
        }
    }
    // Stremio Stream request: /stream/:type/:id.json
    const streamMatch = /^\/stream\/(movie|series)\/([^/]+)\.json$/i.exec(normalizedPath);
    if (streamMatch) {
        const type = streamMatch[1].toLowerCase();
        const rawId = decodeURIComponent(streamMatch[2]);
        try {
            console.log(`[Stream Request] Provider: ${providerFilter}, Type: ${type}, ID: ${rawId}`);
            const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
            const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
            const keyPrefix = ACCESS_KEY ? `/${ACCESS_KEY}` : '';
            const baseUrl = `${proto}://${host}${keyPrefix}`;
            const target = (0, metadata_1.parseStremioId)(type, rawId);
            const streams = await providerManager.getStreams(target, baseUrl, ACCESS_KEY, providerFilter);
            console.log(`[Stream Response] Returning total ${streams.length} stream(s) for ${rawId} (Provider: ${providerFilter})`);
            return sendJson(res, 200, { streams });
        }
        catch (err) {
            console.error(`[Stream Error] ${rawId} (${providerFilter}):`, err);
            return sendJson(res, 200, { streams: [] });
        }
    }
    // 404
    sendJson(res, 404, { error: 'Not Found' });
});
server.listen(PORT, '0.0.0.0', () => {
    const keyPrefix = ACCESS_KEY ? `/${ACCESS_KEY}` : '';
    console.log(`====================================================`);
    console.log(`🚀 Movy Modular Stremio Addon Server running on port ${PORT}`);
    console.log(`⚡ Individual Stremio Tabs (Independent & Parallel):`);
    console.log(`   - Movy:       http://localhost:${PORT}${keyPrefix}/movy/manifest.json`);
    console.log(`   - Hexa (4K):  http://localhost:${PORT}${keyPrefix}/hexa/manifest.json`);
    console.log(`   - MovieBox:   http://localhost:${PORT}${keyPrefix}/moviebox/manifest.json`);
    console.log(`   - Rivestream: http://localhost:${PORT}${keyPrefix}/rivestream/manifest.json`);
    console.log(`⚡ Combined Addon (All Providers in one tab):`);
    console.log(`   - All-in-One: http://localhost:${PORT}${keyPrefix}/manifest.json`);
    console.log(`📊 Diagnostics Dashboard & Stream Prober:`);
    console.log(`   - Web / JSON: http://localhost:${PORT}${keyPrefix}/debug`);
    console.log(`⚡ HLS Multi-Stream Accelerator: Active`);
    if (ACCESS_KEY) {
        console.log(`🔒 Secret Access Token: Enabled (${ACCESS_KEY})`);
    }
    else {
        console.log(`🔓 Secret Access Token: Disabled (Public mode)`);
    }
    console.log(`🔗 Ready to connect into Stremio`);
    console.log(`====================================================`);
});
