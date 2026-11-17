import { decryptMovyPayload } from './crypto';

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
  icon: string;
}

export const SERVER_PROVIDERS: ServerProvider[] = [
  // Tier 1: Fastest direct high-bitrate CDN hosters (4K/2160p + 1080p Master Playlists)
  { name: 'Miami', cluster: 'miami', tier: 1, hoster: 'GoldenKite CDN', icon: '⚡' },
  { name: 'Boise', cluster: 'boise', tier: 1, hoster: 'GoldenKite CDN', icon: '⚡' },

  // Tier 2: High-speed direct Cloudflare edge & direct HLS CDNs
  { name: 'Chicago', cluster: 'chicago', tier: 2, hoster: 'Cloudflare Edge', icon: '🚀' },
  { name: 'Dallas', cluster: 'dallas', tier: 2, hoster: 'MajorPlay CDN', icon: '🚀' },
  { name: 'Seattle', cluster: 'seattle', tier: 2, hoster: 'WarmSquare CDN', icon: '🚀' },
  { name: 'Atlanta', cluster: 'atlanta', tier: 2, hoster: 'WeCollege Direct', icon: '🚀' },
  { name: 'Phoenix', cluster: 'phoenix', tier: 2, hoster: 'WarmSquare CDN', icon: '🚀' },
  { name: 'Portland', cluster: 'portland', tier: 2, hoster: 'WarmSquare CDN', icon: '🚀' },

  // Tier 3: Additional direct hosters
  { name: 'Nashville', cluster: 'nashville', tier: 3, hoster: 'WarmSquare CDN', icon: '📡' },
  { name: 'Austin', cluster: 'austin', tier: 3, hoster: 'Geffe Hoster', icon: '📡' },
  { name: 'Reno', cluster: 'reno', tier: 3, hoster: 'Cloudflare Edge', icon: '📡' },
  { name: 'Oakland', cluster: 'oakland', tier: 3, hoster: 'Cloudflare Edge', icon: '📡' },
  { name: 'Vegas', cluster: 'vegas', tier: 3, hoster: 'Direct Hoster', icon: '📡' },

  // Tier 4: International dubbed servers
  { name: 'Paris', cluster: 'paris', tier: 4, hoster: 'French Dub', icon: '🇫🇷' },
  { name: 'Berlin', cluster: 'berlin', tier: 4, hoster: 'German Dub', icon: '🇩🇪' },
  { name: 'Munich', cluster: 'munich', tier: 4, hoster: 'German Dub', icon: '🇩🇪' },
  { name: 'Cancun', cluster: 'cancun', tier: 4, hoster: 'Spanish Dub', icon: '🇲🇽' },
  { name: 'Delhi', cluster: 'delhi', tier: 4, hoster: 'Hindi Dub', icon: '🇮🇳' },
];

export interface StremioStream {
  name: string;
  title: string;
  url: string;
  behaviorHints?: {
    notWebReady?: boolean;
    bingeGroup?: string;
    proxyHeaders?: {
      request?: Record<string, string>;
    };
  };
}

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

export interface MediaTarget {
  type: 'movie' | 'series';
  imdbId?: string;
  tmdbId?: number;
  season?: number;
  episode?: number;
}

interface ResolvedMetadata {
  tmdbId: number;
  imdbId: string;
  title: string;
  year: string;
}

interface RankedStream {
  stream: StremioStream;
  score: number;
}

export class MovyProvider {
  /**
   * Resolve an IMDb ID (e.g. tt1375666) or TMDB ID into full metadata via db.wecollege.net
   */
  async resolveMetadata(target: MediaTarget): Promise<ResolvedMetadata | null> {
    const isMovie = target.type === 'movie';

    if (target.imdbId) {
      const url = `https://db.wecollege.net/3/find/${target.imdbId}?external_source=imdb_id`;
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) return null;
      const data: any = await res.json();

      if (isMovie && data.movie_results?.length) {
        const item = data.movie_results[0];
        return {
          tmdbId: item.id,
          imdbId: target.imdbId,
          title: item.title,
          year: (item.release_date || '').slice(0, 4) || '2020',
        };
      }

      if (!isMovie && data.tv_results?.length) {
        const item = data.tv_results[0];
        return {
          tmdbId: item.id,
          imdbId: target.imdbId,
          title: item.name,
          year: (item.first_air_date || '').slice(0, 4) || '2020',
        };
      }
    }

    if (target.tmdbId) {
      const endpoint = isMovie ? 'movie' : 'tv';
      const url = `https://db.wecollege.net/3/${endpoint}/${target.tmdbId}?append_to_response=external_ids`;
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) return null;
      const item: any = await res.json();

      return {
        tmdbId: target.tmdbId,
        imdbId: item.external_ids?.imdb_id || target.imdbId || '',
        title: isMovie ? item.title : item.name,
        year: ((isMovie ? item.release_date : item.first_air_date) || '').slice(0, 4) || '2020',
      };
    }

    return null;
  }

  /**
   * Fetch a short-lived seed token from api.wecollege.net
   */
  async getSeed(tmdbId: number): Promise<string> {
    const url = `https://api.wecollege.net/seed?mediaId=${tmdbId}`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      throw new Error(`Failed to fetch seed from api.wecollege.net (HTTP ${res.status})`);
    }
    const data: any = await res.json();
    return data.seed;
  }

  /**
   * Request sources from all cluster providers in parallel and decrypt
   */
  async fetchAllSources(target: MediaTarget, meta: ResolvedMetadata): Promise<Array<{ server: ServerProvider; data: DecryptedSourcesResponse }>> {
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

    // Query all server clusters in parallel with timeout
    const promises = SERVER_PROVIDERS.map(async (server) => {
      try {
        const clusterUrl = `https://api.wecollege.net/${server.cluster}/sources?${query}`;
        const res = await fetch(clusterUrl, { headers: HEADERS, signal: AbortSignal.timeout(3500) });
        if (!res.ok) return null;

        const cipherText = await res.text();
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

  /**
   * Parse Stremio id format (e.g. "tt1375666" or "tt7631058:1:1" or "tmdb:84773:1:1")
   */
  parseStremioId(type: 'movie' | 'series', rawId: string): MediaTarget {
    const isSeries = type === 'series';
    let imdbId: string | undefined;
    let tmdbId: number | undefined;
    let season = 1;
    let episode = 1;

    if (rawId.startsWith('tmdb:')) {
      const parts = rawId.split(':');
      tmdbId = parseInt(parts[1], 10);
      if (isSeries && parts.length >= 4) {
        season = parseInt(parts[2], 10) || 1;
        episode = parseInt(parts[3], 10) || 1;
      }
    } else if (rawId.startsWith('tt')) {
      const parts = rawId.split(':');
      imdbId = parts[0];
      if (isSeries && parts.length >= 3) {
        season = parseInt(parts[1], 10) || 1;
        episode = parseInt(parts[2], 10) || 1;
      }
    } else {
      imdbId = rawId;
    }

    return {
      type,
      imdbId,
      tmdbId,
      season,
      episode,
    };
  }

  /**
   * Calculate quality ranking score
   */
  private getQualityScore(quality: string): { score: number; badge: string } {
    const q = quality.toLowerCase();
    if (q.includes('2160') || q.includes('4k') || q.includes('uhd')) {
      return { score: 500, badge: '4K' };
    }
    if (q.includes('1080')) {
      return { score: 400, badge: '1080P' };
    }
    if (q.includes('auto') || q.includes('hls')) {
      return { score: 350, badge: 'Auto' };
    }
    if (q.includes('720')) {
      return { score: 200, badge: '720P' };
    }
    if (q.includes('480')) {
      return { score: 100, badge: '480P' };
    }
    if (q.includes('360')) {
      return { score: 50, badge: '360P' };
    }
    return { score: 150, badge: quality.toUpperCase() };
  }

  /**
   * High-level entrypoint: Takes a Stremio stream query and returns playable Stremio streams
   * Sorted by fastest source hoster first, then by resolution.
   * If baseUrl is provided, stream URLs are wrapped in the local /proxy/hls endpoint with Referer injection.
   */
  async getStreams(type: 'movie' | 'series', id: string, baseUrl?: string): Promise<StremioStream[]> {
    const target = this.parseStremioId(type, id);
    const meta = await this.resolveMetadata(target);
    if (!meta) return [];

    const serverResults = await this.fetchAllSources(target, meta);
    if (!serverResults || serverResults.length === 0) return [];

    const toStreamUrl = (rawUrl: string) => {
      if (!baseUrl) return rawUrl;
      const encoded = Buffer.from(rawUrl, 'utf8').toString('base64url');
      return `${baseUrl}/proxy/hls?d=${encoded}`;
    };

    const proxyHeaders = {
      Referer: 'https://www.movy.sx/',
      Origin: 'https://www.movy.sx',
      'User-Agent': HEADERS['User-Agent'],
    };

    const bingeGroup = target.type === 'series'
      ? `movysx-${meta.tmdbId}-${target.season}`
      : undefined;

    const rankedStreams: RankedStream[] = [];
    const seenUrls = new Set<string>();

    for (const { server, data } of serverResults) {
      // Base score determined by hoster speed & tier (Tier 1 = 1000, Tier 2 = 700, Tier 3 = 400, Tier 4 = 100)
      const tierBaseScore = Math.max(0, (5 - server.tier) * 300);

      // 1. Master Auto-Adaptive Playlist
      if (data.playlist && !seenUrls.has(data.playlist)) {
        seenUrls.add(data.playlist);
        const autoScore = tierBaseScore + 350;
        rankedStreams.push({
          score: autoScore,
          stream: {
            name: `${server.icon} Movy [Auto]`,
            title: `[${server.name}] ${server.hoster} • Master Playlist (Auto 4K/1080p)\n⚡ Direct High-Speed HLS Stream`,
            url: toStreamUrl(data.playlist),
            behaviorHints: {
              bingeGroup,
              notWebReady: false,
              proxyHeaders: { request: proxyHeaders },
            },
          },
        });
      }

      // 2. Individual quality streams
      for (const src of data.sources || []) {
        if (!src.url || seenUrls.has(src.url)) continue;
        seenUrls.add(src.url);

        const { score: qScore, badge } = this.getQualityScore(src.quality);
        const totalScore = tierBaseScore + qScore;

        rankedStreams.push({
          score: totalScore,
          stream: {
            name: `${server.icon} Movy [${badge}]`,
            title: `[${server.name}] ${server.hoster} • ${src.quality} HLS Stream\n⚡ Direct Stream (${badge})`,
            url: toStreamUrl(src.url),
            behaviorHints: {
              bingeGroup,
              notWebReady: false,
              proxyHeaders: { request: proxyHeaders },
            },
          },
        });
      }
    }

    // Sort all streams by total score descending (Fastest source hosters & highest resolutions first)
    rankedStreams.sort((a, b) => b.score - a.score);

    return rankedStreams.map((r) => r.stream);
  }
}
