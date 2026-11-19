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

export interface StreamFormattingOptions {
  resolutionRaw?: string;
  isMovie?: boolean;
  hoster: string;
  serverName: string;
  audioOverride?: string;
}

export function formatStreamDetails(options: StreamFormattingOptions): {
  score: number;
  badge: string;
  title: string;
} {
  const q = (options.resolutionRaw || 'auto').toLowerCase().trim();
  const isMovie = options.isMovie !== false;

  let score = 250;
  let badge = 'Auto';
  let resolution = '1080p';
  let size = isMovie ? '5.4 GB' : '1.4 GB';
  let videoInfo = 'SDR';
  let audioInfo = '5.1 / AAC';
  const format = 'HLS';

  if (q.includes('2160') || q.includes('4k') || q.includes('uhd')) {
    score = 500;
    badge = '4K';
    resolution = '4K UHD';
    size = isMovie ? '16.5 GB' : '3.8 GB';
    videoInfo = 'HDR';
    audioInfo = 'Dolby Atmos / 5.1';
  } else if (q.includes('1080')) {
    score = 400;
    badge = '1080p';
    resolution = '1080p';
    size = isMovie ? '5.4 GB' : '1.4 GB';
    videoInfo = 'SDR';
    audioInfo = '5.1 / AAC';
  } else if (q.includes('auto') || q.includes('hls') || q.includes('master')) {
    score = 350;
    badge = 'Auto';
    resolution = 'Auto (1080p/4K)';
    size = isMovie ? '5.4 GB' : '1.4 GB';
    videoInfo = 'Adaptive';
    audioInfo = '5.1 / AAC';
  } else if (q.includes('720')) {
    score = 200;
    badge = '720p';
    resolution = '720p';
    size = isMovie ? '2.4 GB' : '650 MB';
    videoInfo = 'SDR';
    audioInfo = 'AAC';
  } else if (q.includes('480')) {
    score = 100;
    badge = '480p';
    resolution = '480p';
    size = isMovie ? '1.1 GB' : '350 MB';
    videoInfo = 'SD';
    audioInfo = 'AAC';
  } else if (q.includes('360')) {
    score = 50;
    badge = '360p';
    resolution = '360p';
    size = isMovie ? '620 MB' : '190 MB';
    videoInfo = 'SD';
    audioInfo = 'AAC';
  } else {
    badge = (options.resolutionRaw || 'Auto').toUpperCase();
    resolution = options.resolutionRaw || 'Auto';
  }

  if (options.audioOverride) {
    audioInfo = options.audioOverride;
  }

  const line1 = `${resolution} • ${options.hoster} (${options.serverName})`;
  const line2 = `${size} • ${format} • ${audioInfo} • ${videoInfo}`;
  const title = `${line1}\n${line2}`;

  return { score, badge, title };
}

export function buildStreamCard(options: {
  addonName?: string;
  title: string;
  streamUrl: string;
  bingeGroup?: string;
  requestHeaders?: Record<string, string>;
}): StremioStream {
  return {
    name: options.addonName || 'Movy',
    title: options.title,
    url: options.streamUrl,
    behaviorHints: {
      notWebReady: false,
      bingeGroup: options.bingeGroup,
      ...(options.requestHeaders ? { proxyHeaders: { request: options.requestHeaders } } : {}),
    },
  };
}
