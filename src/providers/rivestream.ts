import { fetchUpstream } from '../upstream';
import { IStreamProvider, MediaTarget, ResolvedMetadata, StremioStream } from '../types';
import { createProxiedHlsUrl, formatStreamDetails, buildStreamCard } from './base';

const BACKENDS = [
  'https://api.framextv.tech',
  'https://api.framextv.xyz',
  'https://api.framextv.cc',
];

interface RivestreamSource {
  server?: string;
  url?: string;
  quality?: string;
  type?: string;
}

export class RivestreamProvider implements IStreamProvider {
  public readonly name = 'Rivestream';

  public async getStreams(
    target: MediaTarget,
    meta: ResolvedMetadata,
    baseUrl: string,
    accessKey?: string
  ): Promise<StremioStream[]> {
    if (!meta.tmdbId) return [];

    const isMovie = target.type === 'movie';
    let query = `type=${isMovie ? 'movie' : 'tv'}&id=${meta.tmdbId}&provider=bowler`;
    if (!isMovie) {
      query += `&season=${target.season || 1}&episode=${target.episode || 1}`;
    }

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Origin': 'https://framextv.cc',
      'Referer': 'https://framextv.cc/',
    };

    let responseData: any = null;

    for (const backend of BACKENDS) {
      try {
        const url = `${backend}/api/stream?${query}`;
        const res = await fetchUpstream(url, { headers, timeout: 4000 });
        if (res.ok) {
          const json: any = await res.json();
          if (json?.success && Array.isArray(json?.sources) && json.sources.length > 0) {
            responseData = json;
            break;
          }
        }
      } catch {
        // Try next backend
      }
    }

    if (!responseData) return [];

    const streams: StremioStream[] = [];
    const seenUrls = new Set<string>();

    for (const src of responseData.sources as RivestreamSource[]) {
      let rawUrl = (src.url || '').trim();
      if (!rawUrl || !rawUrl.startsWith('http') || seenUrls.has(rawUrl)) continue;

      if (rawUrl.includes('hybrows.workers.dev') && rawUrl.includes('url=')) {
        try {
          const u = new URL(rawUrl);
          const orig = u.searchParams.get('url');
          if (orig) rawUrl = orig;
        } catch {}
      }

      seenUrls.add(rawUrl);

      const serverName = (src.server || 'Direct').replace(/Bowler XVIII\s*·\s*/i, '');
      const rawQuality = src.quality || (rawUrl.includes('/720/') ? '720p' : rawUrl.includes('/480/') ? '480p' : 'Auto');

      const proxiedUrl = createProxiedHlsUrl(rawUrl, baseUrl, { accessKey });

      const details = formatStreamDetails({
        resolutionRaw: rawQuality,
        isMovie,
        hoster: 'Akamai CDN',
        serverName,
        audioOverride: 'Multi-Language',
      });

      streams.push(
        buildStreamCard({
          addonName: 'Movy',
          title: details.title,
          streamUrl: proxiedUrl,
          bingeGroup: isMovie ? undefined : `rivestream-${meta.tmdbId}-${target.season}`,
        })
      );
    }

    return streams;
  }
}
