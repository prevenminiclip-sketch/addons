import { fetchUpstream } from './upstream';

/**
 * HLS Multi-Connection Stream Accelerator & Ahead-of-Time (AOT) Segment Prefetcher
 * 
 * In HLS streaming, video is delivered in ~6-second discrete segments (.m4s / .ts).
 * This engine tracks the active media playlist, detects the playback position, and
 * opens 3-5 concurrent TCP streams to pre-fetch upcoming segments into a fast RAM buffer.
 * When the video player (ExoPlayer / Stremio) requests the next segment, it is served
 * instantly from local memory (0ms latency, gigabit LAN throughput).
 */

interface CachedSegment {
  data: Buffer;
  contentType: string;
  fetchedAt: number;
}

export class HlsAccelerator {
  // Map of Segment URL -> Segment Index & Playlist Key
  private segmentIndexMap = new Map<string, { playlistKey: string; index: number }>();
  
  // Map of Playlist Key -> Ordered List of Segment URLs
  private playlistSegments = new Map<string, string[]>();

  // In-memory Segment Cache (URL -> Buffer)
  private cache = new Map<string, CachedSegment>();

  // In-flight fetch promises to prevent duplicate downloads
  private inFlight = new Map<string, Promise<{ data: Buffer; contentType: string } | null>>();

  // Configuration
  private prefetchAhead = 4; // Fetch next 4 segments ahead in parallel (~24 seconds of video)
  private maxCacheItems = 24; // Keep max 24 segments in RAM (~120 MB max)
  private ttlMs = 2 * 60 * 1000; // 2 minutes TTL per segment

  private defaultHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Origin': 'https://www.movy.sx',
    'Referer': 'https://www.movy.sx/',
  };

  /**
   * Determine the appropriate Origin and Referer headers based on segment destination
   */
  public getHeadersForUrl(url: string, customReferer?: string): Record<string, string> {
    const h = { ...this.defaultHeaders };

    if (customReferer) {
      try {
        h['Referer'] = customReferer;
        h['Origin'] = new URL(customReferer).origin;
      } catch {
        h['Referer'] = customReferer;
      }
      return h;
    }

    if (url.includes('dragonballzfans.xyz')) {
      h['Origin'] = 'https://hexa.su';
      h['Referer'] = 'https://hexa.su/';
    } else if (
      url.includes('slowcloud.live') ||
      url.includes('vercetti.org') ||
      url.includes('nexcloud.live') ||
      url.includes('concretemiracle.lol')
    ) {
      h['Origin'] = 'https://vidrock.to';
      h['Referer'] = 'https://vidrock.to/';
    } else if (url.includes('img1.hscow.com') || url.includes('kkphimplayer7.com')) {
      // Direct open CDNs do not require specific referers
      delete h['Referer'];
      delete h['Origin'];
    }

    return h;
  }

  /**
   * Register an M3U8 playlist and map its ordered segments for prefetching
   */
  public registerPlaylist(playlistUrl: string, segmentUrls: string[]): void {
    if (!segmentUrls.length) return;
    this.playlistSegments.set(playlistUrl, segmentUrls);

    for (let i = 0; i < segmentUrls.length; i++) {
      this.segmentIndexMap.set(segmentUrls[i], {
        playlistKey: playlistUrl,
        index: i,
      });
    }
  }

  /**
   * Get a segment from cache or download it immediately, and trigger background prefetching
   */
  public async getSegment(
    url: string,
    rangeHeader?: string,
    customReferer?: string
  ): Promise<{ data: Buffer; contentType: string } | null> {
    const now = Date.now();

    // 1. Check if already in cache and not expired (only for full segments without range)
    if (!rangeHeader && this.cache.has(url)) {
      const entry = this.cache.get(url)!;
      if (now - entry.fetchedAt < this.ttlMs) {
        this.triggerPrefetch(url, customReferer);
        return { data: entry.data, contentType: entry.contentType };
      } else {
        this.cache.delete(url);
      }
    }

    // 2. Check if already in-flight (downloading in background)
    if (!rangeHeader && this.inFlight.has(url)) {
      const result = await this.inFlight.get(url);
      if (result) {
        this.triggerPrefetch(url, customReferer);
        return { data: result.data, contentType: result.contentType };
      }
    }

    // 3. Download segment directly
    const result = await this.fetchSegmentDirect(url, rangeHeader, customReferer);
    if (result && !rangeHeader) {
      this.storeInCache(url, result);
      this.triggerPrefetch(url, customReferer);
    }

    return result;
  }

  /**
   * Trigger parallel prefetching for the next N segments in the playlist
   */
  private triggerPrefetch(currentUrl: string, customReferer?: string): void {
    const meta = this.segmentIndexMap.get(currentUrl);
    if (!meta) return;

    const segments = this.playlistSegments.get(meta.playlistKey);
    if (!segments) return;

    const startIndex = meta.index + 1;
    const endIndex = Math.min(segments.length, startIndex + this.prefetchAhead);

    // Launch parallel background fetches
    for (let i = startIndex; i < endIndex; i++) {
      const nextUrl = segments[i];
      if (!this.cache.has(nextUrl) && !this.inFlight.has(nextUrl)) {
        const fetchPromise = this.fetchSegmentDirect(nextUrl, undefined, customReferer)
          .then((res) => {
            if (res) this.storeInCache(nextUrl, res);
            this.inFlight.delete(nextUrl);
            return res;
          })
          .catch(() => {
            this.inFlight.delete(nextUrl);
            return null;
          });

        this.inFlight.set(nextUrl, fetchPromise);
      }
    }

    // Clean up older segments behind the playback cursor
    this.pruneOldSegments(segments, meta.index);
  }

  /**
   * Perform direct fetch with appropriate headers via upstream tunnel
   */
  private async fetchSegmentDirect(
    url: string,
    rangeHeader?: string,
    customReferer?: string
  ): Promise<{ data: Buffer; contentType: string } | null> {
    try {
      const reqHeaders = this.getHeadersForUrl(url, customReferer);
      if (rangeHeader) reqHeaders['Range'] = rangeHeader;

      const res = await fetchUpstream(url, { headers: reqHeaders, timeout: 15000 });
      if (!res.ok && res.status !== 206) return null;

      const data = await res.buffer();
      let contentType = (res.headers['content-type'] as string) || '';

      // Fix spoofed image content-types (e.g. image/png on SlowCloud) to proper video MIME
      if (!contentType || contentType.includes('image') || contentType.includes('octet-stream')) {
        if (data.length > 0 && data[0] === 0x47) {
          contentType = 'video/mp2t';
        } else {
          contentType = 'video/mp4';
        }
      }

      return { data, contentType };
    } catch (err) {
      return null;
    }
  }

  /**
   * Save a segment into cache and ensure memory usage remains bounded
   */
  private storeInCache(url: string, item: { data: Buffer; contentType: string }): void {
    if (this.cache.size >= this.maxCacheItems) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(url, {
      data: item.data,
      contentType: item.contentType,
      fetchedAt: Date.now(),
    });
  }

  /**
   * Remove segments that have already been played (behind the playback position)
   */
  private pruneOldSegments(segments: string[], currentIndex: number): void {
    const keepWindowStart = Math.max(0, currentIndex - 2);
    for (let i = 0; i < keepWindowStart; i++) {
      this.cache.delete(segments[i]);
    }
  }
}
