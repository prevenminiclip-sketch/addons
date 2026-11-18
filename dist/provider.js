"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MovyProvider = exports.SERVER_PROVIDERS = void 0;
exports.fetchApi = fetchApi;
const crypto_1 = require("./crypto");
const upstream_1 = require("./upstream");
async function fetchApi(url, options = {}) {
    return (0, upstream_1.fetchUpstream)(url, options);
}
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Origin': 'https://www.movy.sx',
    'Referer': 'https://www.movy.sx/',
};
exports.SERVER_PROVIDERS = [
    // Tier 1: Fastest direct high-bitrate CDN hosters (4K/2160p + 1080p Master Playlists)
    { name: 'Miami', cluster: 'miami', tier: 1, hoster: 'GoldenKite CDN' },
    { name: 'Boise', cluster: 'boise', tier: 1, hoster: 'GoldenKite CDN' },
    // Tier 2: High-speed direct Cloudflare edge & direct HLS CDNs
    { name: 'Chicago', cluster: 'chicago', tier: 2, hoster: 'Cloudflare Edge' },
    { name: 'Dallas', cluster: 'dallas', tier: 2, hoster: 'MajorPlay CDN' },
    { name: 'Seattle', cluster: 'seattle', tier: 2, hoster: 'WarmSquare CDN' },
    { name: 'Atlanta', cluster: 'atlanta', tier: 2, hoster: 'WeCollege Direct' },
    { name: 'Phoenix', cluster: 'phoenix', tier: 2, hoster: 'WarmSquare CDN' },
    { name: 'Portland', cluster: 'portland', tier: 2, hoster: 'WarmSquare CDN' },
    // Tier 3: Additional direct hosters
    { name: 'Nashville', cluster: 'nashville', tier: 3, hoster: 'WarmSquare CDN' },
    { name: 'Austin', cluster: 'austin', tier: 3, hoster: 'Geffe Hoster' },
    { name: 'Reno', cluster: 'reno', tier: 3, hoster: 'Cloudflare Edge' },
    { name: 'Oakland', cluster: 'oakland', tier: 3, hoster: 'Cloudflare Edge' },
    { name: 'Vegas', cluster: 'vegas', tier: 3, hoster: 'Vidmoly' },
    // Tier 4: International dubbed servers
    { name: 'Paris', cluster: 'paris', tier: 4, hoster: 'French Dub' },
    { name: 'Berlin', cluster: 'berlin', tier: 4, hoster: 'German Dub' },
    { name: 'Munich', cluster: 'munich', tier: 4, hoster: 'German Dub' },
    { name: 'Cancun', cluster: 'cancun', tier: 4, hoster: 'Spanish Dub' },
    { name: 'Delhi', cluster: 'delhi', tier: 4, hoster: 'Hindi Dub' },
];
class MovyProvider {
    /**
     * Resolve an IMDb ID (e.g. tt1375666) or TMDB ID into full metadata via db.wecollege.net
     */
    async resolveMetadata(target) {
        const isMovie = target.type === 'movie';
        if (target.imdbId) {
            const url = `https://db.wecollege.net/3/find/${target.imdbId}?external_source=imdb_id`;
            const res = await fetchApi(url, { headers: HEADERS });
            if (!res.ok)
                return null;
            const data = await res.json();
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
            const res = await fetchApi(url, { headers: HEADERS });
            if (!res.ok)
                return null;
            const item = await res.json();
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
    async getSeed(tmdbId) {
        const url = `https://api.wecollege.net/seed?mediaId=${tmdbId}`;
        const res = await fetchApi(url, { headers: HEADERS });
        if (!res.ok) {
            throw new Error(`Failed to fetch seed from api.wecollege.net (HTTP ${res.status})`);
        }
        const data = await res.json();
        return data.seed;
    }
    /**
     * Request sources from all cluster providers in parallel and decrypt
     */
    async fetchAllSources(target, meta) {
        const seed = await this.getSeed(meta.tmdbId);
        const isMovie = target.type === 'movie';
        const baseParams = {
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
        const promises = exports.SERVER_PROVIDERS.map(async (server) => {
            try {
                const clusterUrl = `https://api.wecollege.net/${server.cluster}/sources?${query}`;
                const res = await fetchApi(clusterUrl, { headers: HEADERS, timeout: 8000 });
                if (!res.ok)
                    return null;
                const cipherText = await res.text();
                if (!cipherText || cipherText.length < 20)
                    return null;
                const decryptedJson = (0, crypto_1.decryptMovyPayload)(cipherText, seed, meta.tmdbId);
                const parsed = JSON.parse(decryptedJson);
                if (parsed && (parsed.sources?.length || parsed.playlist)) {
                    return { server, data: parsed };
                }
            }
            catch {
                // Skip failed or timed-out clusters
            }
            return null;
        });
        const settled = await Promise.allSettled(promises);
        const results = [];
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
    parseStremioId(type, rawId) {
        const isSeries = type === 'series';
        let imdbId;
        let tmdbId;
        let season = 1;
        let episode = 1;
        if (rawId.startsWith('tmdb:')) {
            const parts = rawId.split(':');
            tmdbId = parseInt(parts[1], 10);
            if (isSeries && parts.length >= 4) {
                season = parseInt(parts[2], 10) || 1;
                episode = parseInt(parts[3], 10) || 1;
            }
        }
        else if (rawId.startsWith('tt')) {
            const parts = rawId.split(':');
            imdbId = parts[0];
            if (isSeries && parts.length >= 3) {
                season = parseInt(parts[1], 10) || 1;
                episode = parseInt(parts[2], 10) || 1;
            }
        }
        else {
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
    /**
     * Format clean media details, CDN info, file size, audio/video specs without emojis
     */
    formatStreamDetails(quality, isMovie, server) {
        const q = quality.toLowerCase();
        let score = 150;
        let badge = '1080p';
        let resolution = '1080p';
        let size = isMovie ? '5.4 GB' : '1.4 GB';
        let videoInfo = 'SDR';
        let audioInfo = '5.1 / AAC';
        const format = 'HLS';
        if (q.includes('2160') || q.includes('4k') || q.includes('uhd')) {
            score = 500;
            badge = '4K';
            resolution = '4K UHD';
            size = isMovie ? '16.5 GB' : '3.8 GB';
            videoInfo = 'HDR';
            audioInfo = 'Dolby Atmos / 5.1';
        }
        else if (q.includes('1080')) {
            score = 400;
            badge = '1080p';
            resolution = '1080p';
            size = isMovie ? '5.4 GB' : '1.4 GB';
            videoInfo = 'SDR';
            audioInfo = '5.1 / AAC';
        }
        else if (q.includes('auto') || q.includes('hls') || q.includes('master')) {
            score = 350;
            badge = 'Auto';
            resolution = 'Auto (1080p/4K)';
            size = isMovie ? '5.4 GB' : '1.4 GB';
            videoInfo = 'Adaptive';
            audioInfo = '5.1 / AAC';
        }
        else if (q.includes('720')) {
            score = 200;
            badge = '720p';
            resolution = '720p';
            size = isMovie ? '2.4 GB' : '650 MB';
            videoInfo = 'SDR';
            audioInfo = 'AAC';
        }
        else if (q.includes('480')) {
            score = 100;
            badge = '480p';
            resolution = '480p';
            size = isMovie ? '1.1 GB' : '350 MB';
            videoInfo = 'SD';
            audioInfo = 'AAC';
        }
        else if (q.includes('360')) {
            score = 50;
            badge = '360p';
            resolution = '360p';
            size = isMovie ? '620 MB' : '190 MB';
            videoInfo = 'SD';
            audioInfo = 'AAC';
        }
        else {
            badge = quality.toUpperCase();
            resolution = quality;
        }
        // Audio override for international dubs
        if (server.tier === 4) {
            audioInfo = server.hoster;
        }
        const line1 = `${resolution} • ${server.hoster} (${server.name})`;
        const line2 = `${size} • ${format} • ${audioInfo} • ${videoInfo}`;
        const title = `${line1}\n${line2}`;
        return { score, badge, title };
    }
    /**
     * High-level entrypoint: Takes a Stremio stream query and returns playable Stremio streams
     * Sorted by fastest source hoster first, then by resolution.
     * If baseUrl is provided, stream URLs are wrapped in the local /proxy/hls endpoint with Referer injection.
     */
    async getStreams(type, id, baseUrl, accessKey) {
        const target = this.parseStremioId(type, id);
        const meta = await this.resolveMetadata(target);
        if (!meta)
            return [];
        const serverResults = await this.fetchAllSources(target, meta);
        if (!serverResults || serverResults.length === 0)
            return [];
        const isMovie = target.type === 'movie';
        const toStreamUrl = (rawUrl) => {
            if (!baseUrl)
                return rawUrl;
            const encoded = Buffer.from(rawUrl, 'utf8').toString('base64url');
            const keyParam = accessKey ? `&k=${encodeURIComponent(accessKey)}` : '';
            return `${baseUrl}/proxy/hls/stream.m3u8?d=${encoded}${keyParam}`;
        };
        const proxyHeaders = {
            Referer: 'https://www.movy.sx/',
            Origin: 'https://www.movy.sx',
            'User-Agent': HEADERS['User-Agent'],
        };
        const bingeGroup = target.type === 'series'
            ? `movysx-${meta.tmdbId}-${target.season}`
            : undefined;
        const rankedStreams = [];
        const seenUrls = new Set();
        for (const { server, data } of serverResults) {
            // Base score determined by hoster speed & tier (Tier 1 = 1000, Tier 2 = 700, Tier 3 = 400, Tier 4 = 100)
            const tierBaseScore = Math.max(0, (5 - server.tier) * 300);
            // 1. Master Auto-Adaptive Playlist
            if (data.playlist && !seenUrls.has(data.playlist)) {
                seenUrls.add(data.playlist);
                const details = this.formatStreamDetails('auto', isMovie, server);
                const autoScore = tierBaseScore + details.score;
                rankedStreams.push({
                    score: autoScore,
                    stream: {
                        name: 'Movy',
                        title: details.title,
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
                if (!src.url || seenUrls.has(src.url))
                    continue;
                seenUrls.add(src.url);
                const details = this.formatStreamDetails(src.quality, isMovie, server);
                const totalScore = tierBaseScore + details.score;
                rankedStreams.push({
                    score: totalScore,
                    stream: {
                        name: 'Movy',
                        title: details.title,
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
exports.MovyProvider = MovyProvider;
