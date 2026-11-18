"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HlsAccelerator = void 0;
const upstream_1 = require("./upstream");
class HlsAccelerator {
    // Map of Segment URL -> Segment Index & Playlist Key
    segmentIndexMap = new Map();
    // Map of Playlist Key -> Ordered List of Segment URLs
    playlistSegments = new Map();
    // In-memory Segment Cache (URL -> Buffer)
    cache = new Map();
    // In-flight fetch promises to prevent duplicate downloads
    inFlight = new Map();
    // Configuration
    prefetchAhead = 4; // Fetch next 4 segments ahead in parallel (~24 seconds of video)
    maxCacheItems = 16; // Keep max 16 segments in RAM (~80-100 MB max)
    ttlMs = 2 * 60 * 1000; // 2 minutes TTL per segment
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://www.movy.sx',
        'Referer': 'https://www.movy.sx/',
    };
    /**
     * Register an M3U8 playlist and map its ordered segments for prefetching
     */
    registerPlaylist(playlistUrl, segmentUrls) {
        if (!segmentUrls.length)
            return;
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
    async getSegment(url, rangeHeader) {
        const now = Date.now();
        // 1. Check if already in cache and not expired (only for full segments without range)
        if (!rangeHeader && this.cache.has(url)) {
            const entry = this.cache.get(url);
            if (now - entry.fetchedAt < this.ttlMs) {
                // Trigger prefetching for next segments based on cache hit
                this.triggerPrefetch(url);
                return { data: entry.data, contentType: entry.contentType };
            }
            else {
                this.cache.delete(url);
            }
        }
        // 2. Check if already in-flight (downloading in background)
        if (!rangeHeader && this.inFlight.has(url)) {
            const result = await this.inFlight.get(url);
            if (result) {
                this.triggerPrefetch(url);
                return { data: result.data, contentType: result.contentType };
            }
        }
        // 3. Download segment directly
        const result = await this.fetchSegmentDirect(url, rangeHeader);
        if (result && !rangeHeader) {
            this.storeInCache(url, result);
            this.triggerPrefetch(url);
        }
        return result;
    }
    /**
     * Trigger parallel prefetching for the next N segments in the playlist
     */
    triggerPrefetch(currentUrl) {
        const meta = this.segmentIndexMap.get(currentUrl);
        if (!meta)
            return;
        const segments = this.playlistSegments.get(meta.playlistKey);
        if (!segments)
            return;
        const startIndex = meta.index + 1;
        const endIndex = Math.min(segments.length, startIndex + this.prefetchAhead);
        // Launch parallel background fetches
        for (let i = startIndex; i < endIndex; i++) {
            const nextUrl = segments[i];
            if (!this.cache.has(nextUrl) && !this.inFlight.has(nextUrl)) {
                const fetchPromise = this.fetchSegmentDirect(nextUrl)
                    .then((res) => {
                    if (res)
                        this.storeInCache(nextUrl, res);
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
     * Perform direct fetch with Movy headers via upstream tunnel
     */
    async fetchSegmentDirect(url, rangeHeader) {
        try {
            const reqHeaders = { ...this.headers };
            if (rangeHeader)
                reqHeaders['Range'] = rangeHeader;
            const res = await (0, upstream_1.fetchUpstream)(url, { headers: reqHeaders, timeout: 15000 });
            if (!res.ok && res.status !== 206)
                return null;
            const data = await res.buffer();
            const contentType = res.headers['content-type'] || 'video/mp4';
            return { data, contentType };
        }
        catch (err) {
            return null;
        }
    }
    /**
     * Save a segment into cache and ensure memory usage remains bounded
     */
    storeInCache(url, item) {
        if (this.cache.size >= this.maxCacheItems) {
            // Evict oldest entry
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey)
                this.cache.delete(oldestKey);
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
    pruneOldSegments(segments, currentIndex) {
        const keepWindowStart = Math.max(0, currentIndex - 2);
        for (let i = 0; i < keepWindowStart; i++) {
            this.cache.delete(segments[i]);
        }
    }
}
exports.HlsAccelerator = HlsAccelerator;
