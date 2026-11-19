import { StremioStream } from '../types';

export function createProxiedHlsUrl(
  targetUrl: string,
  baseUrl: string,
  options: {
    referer?: string;
    accessKey?: string;
  } = {}
): string {
  const encUrl = Buffer.from(targetUrl, 'utf8').toString('base64url');
  let url = `${baseUrl}/proxy/hls/stream.m3u8?d=${encUrl}`;

  if (options.referer) {
    const encRef = Buffer.from(options.referer, 'utf8').toString('base64url');
    url += `&ref=${encRef}`;
  }

  if (options.accessKey) {
    url += `&k=${encodeURIComponent(options.accessKey)}`;
  }

  return url;
}

export function normalizeQuality(raw: string): string {
  const q = (raw || '').toLowerCase().trim();
  if (q.includes('4k') || q.includes('2160')) return '4K';
  if (q.includes('1080') || q.includes('fhd')) return '1080p';
  if (q.includes('720') || q.includes('hd')) return '720p';
  if (q.includes('480') || q.includes('sd')) return '480p';
  if (q.includes('360')) return '360p';
  return 'Auto';
}

export function formatStreamCard(options: {
  addonBrand: string;
  quality: string;
  title: string;
  year: string;
  serverInfo: string;
  audioInfo?: string;
  streamUrl: string;
  bingeGroup?: string;
  requestHeaders?: Record<string, string>;
}): StremioStream {
  const quality = normalizeQuality(options.quality);
  const audio = options.audioInfo ? `\n🌐 ${options.audioInfo}` : '';

  return {
    name: `${options.addonBrand} [${quality}]`,
    title: `🎬 ${options.title} (${options.year})\n⚡ ${options.serverInfo} • ${quality}${audio}`,
    url: options.streamUrl,
    behaviorHints: {
      notWebReady: false,
      bingeGroup: options.bingeGroup || `${options.addonBrand.toLowerCase()}-${quality.toLowerCase()}`,
      ...(options.requestHeaders ? { proxyHeaders: { request: options.requestHeaders } } : {}),
    },
  };
}
