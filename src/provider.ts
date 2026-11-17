import { decryptMovyPayload } from './crypto';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Origin': 'https://www.movy.sx',
  'Referer': 'https://www.movy.sx/',
};

const CLUSTERS = ['miami', 'boise', 'seattle', 'atlanta', 'phoenix'];

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
   * Request sources from cluster endpoints and decrypt the payload
   */
  async fetchSources(target: MediaTarget, meta: ResolvedMetadata): Promise<DecryptedSourcesResponse | null> {
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

    // Try clusters in order until one succeeds
    for (const cluster of CLUSTERS) {
      try {
        const clusterUrl = `https://api.wecollege.net/${cluster}/sources?${query}`;
        const res = await fetch(clusterUrl, { headers: HEADERS, signal: AbortSignal.timeout(4000) });
        if (!res.ok) continue;

        const cipherText = await res.text();
        if (!cipherText || cipherText.length < 20) continue;

        const decryptedJson = decryptMovyPayload(cipherText, seed, meta.tmdbId);
        const parsed = JSON.parse(decryptedJson) as DecryptedSourcesResponse;
        if (parsed && (parsed.sources?.length || parsed.playlist)) {
          return parsed;
        }
      } catch {
        // Try next cluster
      }
    }

    return null;
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
   * High-level entrypoint: Takes a Stremio stream query and returns playable Stremio streams
   */
  async getStreams(type: 'movie' | 'series', id: string): Promise<StremioStream[]> {
    const target = this.parseStremioId(type, id);
    const meta = await this.resolveMetadata(target);
    if (!meta) return [];

    const sourcesData = await this.fetchSources(target, meta);
    if (!sourcesData) return [];

    const streams: StremioStream[] = [];
    const proxyHeaders = {
      Referer: 'https://www.movy.sx/',
      Origin: 'https://www.movy.sx',
      'User-Agent': HEADERS['User-Agent'],
    };

    const bingeGroup = target.type === 'series'
      ? `movysx-${meta.tmdbId}-${target.season}`
      : undefined;

    // 1. Add Master Auto-Adaptive Playlist first if available
    if (sourcesData.playlist) {
      streams.push({
        name: 'Movy [Auto]',
        title: `Movy.sx • Master Playlist (Auto 4K/1080p)\n⚡ Fast CDN HLS Stream`,
        url: sourcesData.playlist,
        behaviorHints: {
          bingeGroup,
          notWebReady: false,
          proxyHeaders: { request: proxyHeaders },
        },
      });
    }

    // 2. Add individual quality streams (sorted high -> low: 2160p, 1080p, 720p, 480p)
    const qualitySortOrder: Record<string, number> = {
      '2160p': 4,
      '4k': 4,
      '1080p': 3,
      '720p': 2,
      '480p': 1,
    };

    const sortedSources = [...(sourcesData.sources || [])].sort((a, b) => {
      const qA = qualitySortOrder[a.quality.toLowerCase()] || 0;
      const qB = qualitySortOrder[b.quality.toLowerCase()] || 0;
      return qB - qA;
    });

    for (const src of sortedSources) {
      const badge = src.quality.toUpperCase().includes('2160') ? '4K' : src.quality.toUpperCase();
      streams.push({
        name: `Movy [${badge}]`,
        title: `Movy.sx • ${src.quality} HLS Stream\n⚡ Direct CDN (${badge})`,
        url: src.url,
        behaviorHints: {
          bingeGroup,
          notWebReady: false,
          proxyHeaders: { request: proxyHeaders },
        },
      });
    }

    return streams;
  }
}
