import { fetchUpstream } from '../upstream';
import { IStreamProvider, MediaTarget, ResolvedMetadata, StremioStream } from '../types';
import { createProxiedHlsUrl, formatStreamDetails, buildStreamCard } from './base';

const BACKENDS = [
  'https://api.framextv.tech',
  'https://api.framextv.xyz',
  'https://api.framextv.cc',
];

interface FrameXSource {
  server?: string;
  url?: string;
  quality?: string;
  type?: string;
}

export class HexaProvider implements IStreamProvider {
  public readonly name = 'Hexa';

  public async getStreams(
    target: MediaTarget,
    meta: ResolvedMetadata,
    baseUrl: string,
    accessKey?: string
  ): Promise<StremioStream[]> {
    if (!meta.tmdbId) return [];

    const isMovie = target.type === 'movie';
    let query = `type=${isMovie ? 'movie' : 'tv'}&id=${meta.tmdbId}&provider=royal_champion&codecs=hevc`;
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

    for (const src of responseData.sources as FrameXSource[]) {
      const rawUrl = (src.url || '').trim();
      if (!rawUrl || !rawUrl.startsWith('http') || seenUrls.has(rawUrl)) continue;
      seenUrls.add(rawUrl);

      const serverName = src.server || 'Hexa Direct';
      const isAlpha = rawUrl.includes('fuckme.dragonballzfans.xyz') || serverName.includes('Alpha');
      const neededReferer = isAlpha ? 'https://hexa.su/' : undefined;

      const proxiedUrl = createProxiedHlsUrl(rawUrl, baseUrl, {
        referer: neededReferer,
        accessKey,
      });

      const details = formatStreamDetails({
        resolutionRaw: isAlpha ? '4k' : 'auto',
        isMovie,
        hoster: 'Hexa Direct CDN',
        serverName: serverName.replace(/Royal Champion I\s*·\s*/i, ''),
        audioOverride: isAlpha ? 'Dolby Atmos / 5.1' : '5.1 / AAC',
      });

      streams.push(
        buildStreamCard({
          addonName: 'Movy',
          title: details.title,
          streamUrl: proxiedUrl,
          bingeGroup: isMovie ? undefined : `hexa-${meta.tmdbId}-${target.season}`,
        })
      );
    }

    return streams;
  }
}
