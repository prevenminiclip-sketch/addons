import { fetchUpstream } from '../upstream';
import { IStreamProvider, MediaTarget, ResolvedMetadata, StremioStream } from '../types';
import { createProxiedHlsUrl, formatStreamDetails, buildStreamCard } from './base';

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
        timeout: 4500,
      });

      if (!res.ok) {
        return [];
      }

      const data: any = await res.json();
      if (!data?.success || !Array.isArray(data?.sources)) {
        return [];
      }

      interface RankedStream {
        stream: StremioStream;
        score: number;
      }

      const rankedStreams: RankedStream[] = [];
      const seenUrls = new Set<string>();

      for (const item of data.sources as MovieBoxSource[]) {
        const directUrl = (item.original_url || item.url || '').trim();
        if (!directUrl || !directUrl.startsWith('http') || seenUrls.has(directUrl)) {
          continue;
        }
        seenUrls.add(directUrl);

        let neededReferer: string | undefined;
        if (
          directUrl.includes('slowcloud.live') ||
          directUrl.includes('vercetti.org') ||
          directUrl.includes('nexcloud.live') ||
          directUrl.includes('concretemiracle.lol')
        ) {
          neededReferer = 'https://vidrock.to/';
        }

        const isHls = directUrl.includes('.m3u8') || item.type?.toLowerCase() === 'hls';
        const streamUrl = isHls
          ? createProxiedHlsUrl(directUrl, baseUrl, { referer: neededReferer, accessKey })
          : directUrl;

        const subProvider = item.provider || 'Vidrock';
        const serverName = item.server || 'Direct';
        const rawQuality = item.resolution || item.quality || '1080p';

        const details = formatStreamDetails({
          resolutionRaw: rawQuality,
          isMovie,
          hoster: `${subProvider} CDN`,
          serverName,
          audioOverride: item.language,
        });

        const stream = buildStreamCard({
          addonName: 'MovieBox',
          title: details.title,
          streamUrl,
          bingeGroup: isMovie ? undefined : `moviebox-${subProvider.toLowerCase()}-${meta.tmdbId}`,
        });

        rankedStreams.push({ stream, score: details.score });
      }

      rankedStreams.sort((a, b) => b.score - a.score);
      return rankedStreams.map((r) => r.stream);
    } catch (err) {
      console.error('[MovieBox Provider Error]', err);
      return [];
    }
  }
}
