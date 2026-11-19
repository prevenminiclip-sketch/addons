import { fetchUpstream } from '../upstream';
import { IStreamProvider, MediaTarget, ResolvedMetadata, StremioStream } from '../types';
import { createProxiedHlsUrl, formatStreamCard, normalizeQuality } from './base';

interface MovieBoxSource {
  provider?: string;
  server?: string;
  url?: string;
  original_url?: string;
  resolution?: string;
  quality?: string;
  type?: string;
  language?: string;
}

export class MovieBoxProvider implements IStreamProvider {
  public readonly name = 'MovieBox';

  public async getStreams(
    target: MediaTarget,
    meta: ResolvedMetadata,
    baseUrl: string,
    accessKey?: string
  ): Promise<StremioStream[]> {
    if (!meta.tmdbId) return [];

    const isMovie = target.type === 'movie';
    let apiUrl = `https://themoviebox.uk/api/resolve?id=${meta.tmdbId}&type=${isMovie ? 'movie' : 'tv'}`;
    if (!isMovie) {
      apiUrl += `&s=${target.season || 1}&e=${target.episode || 1}`;
    }

    try {
      const res = await fetchUpstream(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
        },
        timeout: 6000,
      });

      if (!res.ok) {
        console.warn(`[MovieBox Provider] HTTP ${res.status} for TMDB ID ${meta.tmdbId}`);
        return [];
      }

      const data: any = await res.json();
      if (!data?.success || !Array.isArray(data?.sources)) {
        return [];
      }

      const streams: StremioStream[] = [];
      const seenUrls = new Set<string>();

      for (const item of data.sources as MovieBoxSource[]) {
        // Extract the direct stream URL, bypassing any site proxy wrapper
        const directUrl = (item.original_url || item.url || '').trim();
        if (!directUrl || !directUrl.startsWith('http') || seenUrls.has(directUrl)) {
          continue;
        }
        seenUrls.add(directUrl);

        // Determine referer needed by upstream CDN
        let neededReferer: string | undefined;
        if (
          directUrl.includes('slowcloud.live') ||
          directUrl.includes('vercetti.org') ||
          directUrl.includes('nexcloud.live') ||
          directUrl.includes('concretemiracle.lol')
        ) {
          neededReferer = 'https://vidrock.to/';
        }

        // Route HLS streams through our local Portainer accelerator
        const isHls = directUrl.includes('.m3u8') || item.type?.toLowerCase() === 'hls';
        const streamUrl = isHls
          ? createProxiedHlsUrl(directUrl, baseUrl, { referer: neededReferer, accessKey })
          : directUrl;

        const rawQuality = item.resolution || item.quality || '1080p';
        const quality = normalizeQuality(rawQuality);
        const subProvider = item.provider || 'Vidrock';
        const serverName = item.server || 'Direct';
        const lang = item.language || 'English';

        streams.push(
          formatStreamCard({
            addonBrand: 'MovieBox',
            quality,
            title: meta.title,
            year: meta.year,
            serverInfo: `${subProvider} · ${serverName}`,
            audioInfo: lang,
            streamUrl,
            bingeGroup: `moviebox-${subProvider.toLowerCase()}-${quality.toLowerCase()}`,
          })
        );
      }

      // Sort: 1080p > 720p > Auto > 480p
      streams.sort((a, b) => {
        const score = (name: string) => {
          if (name.includes('[4K]')) return 400;
          if (name.includes('[1080p]')) return 300;
          if (name.includes('[720p]')) return 200;
          return 100;
        };
        return score(b.name) - score(a.name);
      });

      return streams;
    } catch (err) {
      console.error('[MovieBox Provider Error]', err);
      return [];
    }
  }
}
