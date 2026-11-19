import { fetchUpstream } from './upstream';
import { MediaTarget, ResolvedMetadata } from './types';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Origin': 'https://www.movy.sx',
  'Referer': 'https://www.movy.sx/',
};

// 24-hour in-memory cache for resolved metadata
const metaCache = new Map<string, { meta: ResolvedMetadata; expireAt: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function parseStremioId(type: 'movie' | 'series', rawId: string): MediaTarget {
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

export async function resolveMetadata(target: MediaTarget): Promise<ResolvedMetadata | null> {
  const cacheKey = `${target.type}:${target.imdbId || ''}:${target.tmdbId || ''}`;
  const cached = metaCache.get(cacheKey);
  if (cached && Date.now() < cached.expireAt) {
    return cached.meta;
  }

  const isMovie = target.type === 'movie';

  // 1. Resolve via IMDb ID
  if (target.imdbId) {
    try {
      const url = `https://db.wecollege.net/3/find/${target.imdbId}?external_source=imdb_id`;
      const res = await fetchUpstream(url, { headers: HEADERS, timeout: 6000 });
      if (res.ok) {
        const data: any = await res.json();
        if (isMovie && data.movie_results?.length) {
          const item = data.movie_results[0];
          const result: ResolvedMetadata = {
            tmdbId: item.id,
            imdbId: target.imdbId,
            title: item.title,
            year: (item.release_date || '').slice(0, 4) || '2020',
          };
          metaCache.set(cacheKey, { meta: result, expireAt: Date.now() + CACHE_TTL_MS });
          return result;
        }

        if (!isMovie && data.tv_results?.length) {
          const item = data.tv_results[0];
          const result: ResolvedMetadata = {
            tmdbId: item.id,
            imdbId: target.imdbId,
            title: item.name,
            year: (item.first_air_date || '').slice(0, 4) || '2020',
          };
          metaCache.set(cacheKey, { meta: result, expireAt: Date.now() + CACHE_TTL_MS });
          return result;
        }
      }
    } catch (err) {
      console.warn(`[Metadata] WeCollege find failed for ${target.imdbId}:`, err);
    }
  }

  // 2. Resolve via TMDB ID
  if (target.tmdbId) {
    try {
      const endpoint = isMovie ? 'movie' : 'tv';
      const url = `https://db.wecollege.net/3/${endpoint}/${target.tmdbId}?append_to_response=external_ids`;
      const res = await fetchUpstream(url, { headers: HEADERS, timeout: 6000 });
      if (res.ok) {
        const item: any = await res.json();
        const result: ResolvedMetadata = {
          tmdbId: target.tmdbId,
          imdbId: item.external_ids?.imdb_id || target.imdbId || '',
          title: isMovie ? item.title : item.name,
          year: ((isMovie ? item.release_date : item.first_air_date) || '').slice(0, 4) || '2020',
        };
        metaCache.set(cacheKey, { meta: result, expireAt: Date.now() + CACHE_TTL_MS });
        return result;
      }
    } catch (err) {
      console.warn(`[Metadata] WeCollege TMDB lookup failed for ${target.tmdbId}:`, err);
    }
  }

  // 3. Fallback to Cinemeta for IMDb IDs if WeCollege had an issue
  if (target.imdbId) {
    try {
      const cinemetaType = isMovie ? 'movie' : 'series';
      const cinemetaUrl = `https://v3-cinemeta.strem.io/meta/${cinemetaType}/${target.imdbId}.json`;
      const res = await fetchUpstream(cinemetaUrl, { timeout: 5000 });
      if (res.ok) {
        const json: any = await res.json();
        const meta = json?.meta;
        if (meta && meta.name) {
          const resolvedTmdb =
            target.tmdbId ||
            (typeof meta.moviedb_id === 'number' ? meta.moviedb_id : parseInt(meta.moviedb_id, 10)) ||
            0;

          const result: ResolvedMetadata = {
            tmdbId: resolvedTmdb,
            imdbId: target.imdbId,
            title: meta.name,
            year: (meta.year || meta.releaseInfo || '').slice(0, 4) || '2020',
          };
          metaCache.set(cacheKey, { meta: result, expireAt: Date.now() + CACHE_TTL_MS });
          return result;
        }
      }
    } catch (err) {
      console.warn(`[Metadata] Cinemeta fallback failed for ${target.imdbId}:`, err);
    }
  }

  return null;
}
