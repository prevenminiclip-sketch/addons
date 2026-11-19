import { decryptMovyPayload } from '../crypto';
import { fetchUpstream } from '../upstream';
import { IStreamProvider, MediaTarget, ResolvedMetadata, StremioStream } from '../types';
import { createProxiedHlsUrl, formatStreamDetails, buildStreamCard } from './base';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Origin': 'https://www.movy.sx',
  'Referer': 'https://www.movy.sx/',
};

export interface ServerProvider {
  name: string;
  cluster: string;
  tier: number; // 1 = Fastest 4K/UHD CDN, 2 = High-Speed Direct/Cloudflare CDN, 3 = Alternate Direct, 4 = International Dubs
  hoster: string;
}

export const SERVER_PROVIDERS: ServerProvider[] = [
  // Tier 1: Fastest direct high-bitrate CDN hosters (4K/2160p + 1080p Master Playlists)
  { name: 'Miami', cluster: 'miami', tier: 1, hoster: 'GoldenKite CDN' },
  { name: 'Boise', cluster: 'boise', tier: 1, hoster: 'GoldenKite CDN' },

  // Tier 2: High-speed direct Cloudflare edge & direct HLS CDNs
  { name: 'Chicago', cluster: 'chicago', tier: 2, hoster: 'Cloudflare Edge' },
  { name: 'Seattle', cluster: 'seattle', tier: 2, hoster: 'WarmSquare CDN' },
  { name: 'Atlanta', cluster: 'atlanta', tier: 2, hoster: 'WeCollege Direct' },
  { name: 'Phoenix', cluster: 'phoenix', tier: 2, hoster: 'WarmSquare CDN' },
  { name: 'Portland', cluster: 'portland', tier: 2, hoster: 'WarmSquare CDN' },

  // Tier 3: Additional direct hosters
  { name: 'Nashville', cluster: 'nashville', tier: 3, hoster: 'WarmSquare CDN' },
  { name: 'Austin', cluster: 'austin', tier: 3, hoster: 'Geffe Hoster' },
  { name: 'Reno', cluster: 'reno', tier: 3, hoster: 'Cloudflare Edge' },
  { name: 'Oakland', cluster: 'oakland', tier: 3, hoster: 'Cloudflare Edge' },

  // Tier 4: International dubbed servers
  { name: 'Paris', cluster: 'paris', tier: 4, hoster: 'French Dub' },
  { name: 'Munich', cluster: 'munich', tier: 4, hoster: 'German Dub' },
  { name: 'Cancun', cluster: 'cancun', tier: 4, hoster: 'Spanish Dub' },
  { name: 'Delhi', cluster: 'delhi', tier: 4, hoster: 'Hindi Dub' },
];

export interface DecryptedSourcesResponse {
  playlist?: string;
  sources?: Array<{
    quality: string;
    url: string;
  }>;
  subtitles?: Array<{
    url: string;
    lang: string;
    label?: string;
  }>;
  thumbnail?: string;
}

export class MovyProvider implements IStreamProvider {
  public readonly name = 'Movy';

  private async getSeed(tmdbId: number): Promise<string> {
    const url = `https://api.wecollege.net/seed?mediaId=${tmdbId}`;
    const res = await fetchUpstream(url, { headers: HEADERS, timeout: 3500 });
    if (!res.ok) {
      throw new Error(`Failed to fetch seed from api.wecollege.net (HTTP ${res.status})`);
    }
    const data = await res.json(3500);
    return data.seed;
  }

  public async fetchAllSources(
    target: MediaTarget,
    meta: ResolvedMetadata
  ): Promise<Array<{ server: ServerProvider; data: DecryptedSourcesResponse }>> {
    const seed = await this.getSeed(meta.tmdbId);
    const isMovie = target.type === 'movie';

    const baseParams: Record<string, string> = {
      title: meta.title,
      mediaType: isMovie ? 'movie' : 'tv',
      year: meta.year,
      tmdbId: String(meta.tmdbId),
      imdbId: meta.imdbId,
      enc: '2',
      seed: seed,
    };

    if (!isMovie) {
      baseParams.seasonId = String(target.season || 1);
      baseParams.episodeId = String(target.episode || 1);
    }

    const query = new URLSearchParams(baseParams).toString();

    // Query active server clusters in parallel with a 3.0s per-cluster timeout
    const promises = SERVER_PROVIDERS.map(async (server) => {
      try {
        const clusterUrl = `https://api.wecollege.net/${server.cluster}/sources?${query}`;
        const res = await fetchUpstream(clusterUrl, { headers: HEADERS, timeout: 3000 });
        if (!res.ok) return null;

        const cipherText = await res.text(3000);
        if (!cipherText || cipherText.length < 20) return null;

        const decryptedJson = decryptMovyPayload(cipherText, seed, meta.tmdbId);
        const parsed = JSON.parse(decryptedJson) as DecryptedSourcesResponse;
        if (parsed && (parsed.sources?.length || parsed.playlist)) {
          return { server, data: parsed };
        }
      } catch {
        // Skip failed or timed-out clusters
      }
      return null;
    });

    const settled = await Promise.allSettled(promises);
    const results: Array<{ server: ServerProvider; data: DecryptedSourcesResponse }> = [];

    for (const item of settled) {
      if (item.status === 'fulfilled' && item.value) {
        results.push(item.value);
      }
    }

    return results;
  }

  public async getStreams(
    target: MediaTarget,
    meta: ResolvedMetadata,
    baseUrl: string,
    accessKey?: string
  ): Promise<StremioStream[]> {
    try {
      const clusterResults = await this.fetchAllSources(target, meta);
      if (!clusterResults.length) return [];

      const isMovie = target.type === 'movie';
      const bingeGroup = !isMovie ? `movysx-${meta.tmdbId}-${target.season}` : undefined;

      interface RankedStream {
        stream: StremioStream;
        score: number;
      }

      const rankedStreams: RankedStream[] = [];
      const seenUrls = new Set<string>();

      for (const { server, data } of clusterResults) {
        const tierBaseScore = Math.max(0, (5 - server.tier) * 300);

        // 1. Master Auto-Adaptive Playlist
        if (data.playlist && !seenUrls.has(data.playlist)) {
          seenUrls.add(data.playlist);
          const proxiedUrl = createProxiedHlsUrl(data.playlist, baseUrl, {
            referer: 'https://www.movy.sx/',
            accessKey,
          });

          const details = formatStreamDetails({
            resolutionRaw: server.tier === 1 ? '4k' : 'auto',
            isMovie,
            hoster: server.hoster,
            serverName: server.name,
            audioOverride: server.tier === 4 ? server.hoster : undefined,
          });

          const stream = buildStreamCard({
            addonName: 'Movy',
            title: details.title,
            streamUrl: proxiedUrl,
            bingeGroup,
            requestHeaders: {
              Referer: 'https://www.movy.sx/',
              Origin: 'https://www.movy.sx',
              'User-Agent': HEADERS['User-Agent'],
            },
          });

          rankedStreams.push({ stream, score: tierBaseScore + details.score });
        }

        // 2. Individual quality streams
        if (data.sources && Array.isArray(data.sources)) {
          for (const src of data.sources) {
            if (!src.url || seenUrls.has(src.url)) continue;
            seenUrls.add(src.url);

            const proxiedUrl = createProxiedHlsUrl(src.url, baseUrl, {
              referer: 'https://www.movy.sx/',
              accessKey,
            });

            const details = formatStreamDetails({
              resolutionRaw: src.quality,
              isMovie,
              hoster: server.hoster,
              serverName: server.name,
              audioOverride: server.tier === 4 ? server.hoster : undefined,
            });

            const stream = buildStreamCard({
              addonName: 'Movy',
              title: details.title,
              streamUrl: proxiedUrl,
              bingeGroup,
              requestHeaders: {
                Referer: 'https://www.movy.sx/',
                Origin: 'https://www.movy.sx',
                'User-Agent': HEADERS['User-Agent'],
              },
            });

            rankedStreams.push({ stream, score: tierBaseScore + details.score });
          }
        }
      }

      rankedStreams.sort((a, b) => b.score - a.score);
      return rankedStreams.map((r) => r.stream);
    } catch (err) {
      console.error('[Movy Provider Error]', err);
      return [];
    }
  }
}
