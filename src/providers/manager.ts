import { IStreamProvider, MediaTarget, ResolvedMetadata, StremioStream } from '../types';
import { resolveMetadata } from '../metadata';
import { fetchUpstream } from '../upstream';
import { MovyProvider } from './movy';
import { MovieBoxProvider } from './moviebox';
import { HexaProvider } from './hexa';
import { RivestreamProvider } from './rivestream';

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T, name: string): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`[Provider Timeout] ${name} exceeded ${ms}ms limit, continuing with other providers...`);
      resolve(fallback);
    }, ms);

    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        console.error(`[Provider Exception] ${name} threw an error:`, err?.message || err);
        resolve(fallback);
      });
  });
}

export interface ProviderDiagnostic {
  id: string;
  name: string;
  status: 'OK' | 'EMPTY' | 'TIMEOUT' | 'ERROR';
  latencyMs: number;
  streamCount: number;
  error?: string;
  firstStreamTitle?: string;
  firstStreamUrl?: string;
}

export interface DiagnosticsReport {
  timestamp: string;
  target: MediaTarget;
  resolvedMetadata: ResolvedMetadata | null;
  metadataLatencyMs: number;
  providers: ProviderDiagnostic[];
  totalStreams: number;
}

export interface StreamProbeReport {
  timestamp: string;
  targetUrl: string;
  referer?: string;
  verdict: 'READY_TO_PLAY' | 'AUDIO_FAILED' | 'VIDEO_CHUNK_FAILED' | 'MASTER_FAILED' | 'TIMEOUT';
  masterStatus?: number;
  masterContentType?: string;
  audioTrackDetected?: boolean;
  audioTrackStatus?: number;
  videoChunkStatus?: number;
  videoChunkBytes?: number;
  latencyMs: number;
  details: string;
}

export class ProviderManager {
  private providers: Map<string, IStreamProvider>;
  private primaryProvider: IStreamProvider;
  private secondaryProviders: IStreamProvider[];

  constructor() {
    const movy = new MovyProvider();
    const hexa = new HexaProvider();
    const moviebox = new MovieBoxProvider();
    const rivestream = new RivestreamProvider();

    this.primaryProvider = movy;
    this.secondaryProviders = [hexa, moviebox, rivestream];

    this.providers = new Map<string, IStreamProvider>([
      ['movy', movy],
      ['hexa', hexa],
      ['moviebox', moviebox],
      ['rivestream', rivestream],
    ]);
  }

  public getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  public async getStreams(
    target: MediaTarget,
    baseUrl: string,
    accessKey?: string,
    providerFilter?: string
  ): Promise<StremioStream[]> {
    // 1. Resolve metadata once
    const meta: ResolvedMetadata | null = await resolveMetadata(target);
    if (!meta) {
      console.warn(`[ProviderManager] Unable to resolve metadata for target:`, target);
      return [];
    }

    const filter = (providerFilter || 'all').toLowerCase().trim();

    // Fast-path: Single modular provider requested by dedicated Stremio tab
    if (filter !== 'all' && this.providers.has(filter)) {
      const provider = this.providers.get(filter)!;
      try {
        console.log(`[ProviderManager] Querying single provider "${provider.name}" for "${meta.title}"...`);
        return await withTimeout(
          provider.getStreams(target, meta, baseUrl, accessKey),
          10000,
          [],
          provider.name
        );
      } catch (err: any) {
        console.error(`[Provider Exception] ${provider.name} failed:`, err?.message || err);
        return [];
      }
    }

    // 10-second timeout ensures all clusters complete cleanly
    const PROVIDER_TIMEOUT_MS = 10000;

    // 2. Query primary (Movy) and all secondary providers concurrently
    const [primaryResult, ...secondaryResults] = await Promise.allSettled([
      withTimeout(
        this.primaryProvider.getStreams(target, meta, baseUrl, accessKey),
        PROVIDER_TIMEOUT_MS,
        [],
        this.primaryProvider.name
      ),
      ...this.secondaryProviders.map((p) =>
        withTimeout(
          p.getStreams(target, meta, baseUrl, accessKey),
          PROVIDER_TIMEOUT_MS,
          [],
          p.name
        )
      ),
    ]);

    // 3. Collect Movy streams (guaranteed at the top of the list)
    const movyStreams: StremioStream[] =
      primaryResult.status === 'fulfilled' ? primaryResult.value : [];

    // 4. Collect and sort secondary streams
    const secondaryStreams: StremioStream[] = [];
    for (let i = 0; i < secondaryResults.length; i++) {
      const res = secondaryResults[i];
      if (res.status === 'fulfilled' && Array.isArray(res.value)) {
        secondaryStreams.push(...res.value);
      }
    }

    // Rank secondary streams: 4K UHD > 1080p > 720p > Auto > 480p
    secondaryStreams.sort((a, b) => {
      const score = (s: StremioStream) => {
        const titleUpper = s.title.toUpperCase();
        if (titleUpper.includes('4K') || titleUpper.includes('2160')) return 400;
        if (titleUpper.includes('1080P')) return 300;
        if (titleUpper.includes('720P')) return 200;
        if (titleUpper.includes('AUTO')) return 150;
        return 100;
      };
      return score(b) - score(a);
    });

    console.log(
      `[ProviderManager] Result: ${movyStreams.length} Movy stream(s), ${secondaryStreams.length} alternate stream(s) for "${meta.title}" (${meta.year})`
    );

    // Return Movy first, followed by alternates
    return [...movyStreams, ...secondaryStreams];
  }

  public async getDiagnostics(
    target: MediaTarget,
    baseUrl: string,
    accessKey?: string,
    providerFilter?: string
  ): Promise<DiagnosticsReport> {
    const startMeta = Date.now();
    const meta = await resolveMetadata(target);
    const metadataLatencyMs = Date.now() - startMeta;

    const report: DiagnosticsReport = {
      timestamp: new Date().toISOString(),
      target,
      resolvedMetadata: meta,
      metadataLatencyMs,
      providers: [],
      totalStreams: 0,
    };

    if (!meta) {
      return report;
    }

    const filter = (providerFilter || 'all').toLowerCase().trim();
    const toTest =
      filter !== 'all' && this.providers.has(filter)
        ? [this.providers.get(filter)!]
        : Array.from(this.providers.values());

    const tests = toTest.map(async (provider) => {
      const startTime = Date.now();
      const diag: ProviderDiagnostic = {
        id: provider.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
        name: provider.name,
        status: 'OK',
        latencyMs: 0,
        streamCount: 0,
      };

      try {
        const streams = await withTimeout<StremioStream[] | null>(
          provider.getStreams(target, meta, baseUrl, accessKey),
          10000,
          null,
          provider.name
        );

        diag.latencyMs = Date.now() - startTime;
        if (streams === null) {
          diag.status = 'TIMEOUT';
          diag.error = 'Exceeded 10000ms timeout limit';
        } else {
          diag.streamCount = streams.length;
          if (streams.length === 0) {
            diag.status = 'EMPTY';
            diag.error = 'No sources returned by upstream for this title';
          } else {
            diag.status = 'OK';
            diag.firstStreamTitle = streams[0].title.replace(/\n/g, ' • ');
            diag.firstStreamUrl = streams[0].url;
          }
        }
      } catch (err: any) {
        diag.latencyMs = Date.now() - startTime;
        diag.status = 'ERROR';
        diag.error = err?.message || String(err);
      }

      return diag;
    });

    report.providers = await Promise.all(tests);
    report.totalStreams = report.providers.reduce((sum, p) => sum + p.streamCount, 0);

    return report;
  }

  public async probeStream(targetUrl: string, customReferer?: string): Promise<StreamProbeReport> {
    const start = Date.now();
    const report: StreamProbeReport = {
      timestamp: new Date().toISOString(),
      targetUrl,
      referer: customReferer,
      verdict: 'READY_TO_PLAY',
      latencyMs: 0,
      details: '',
    };

    try {
      const headers: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      };
      if (customReferer) {
        headers['Referer'] = customReferer;
        try {
          headers['Origin'] = new URL(customReferer).origin;
        } catch {}
      }

      // 1. Fetch master m3u8
      const masterRes = await fetchUpstream(targetUrl, { headers, timeout: 5000 });
      report.masterStatus = masterRes.status;
      report.masterContentType = (masterRes.headers['content-type'] as string) || '';

      if (!masterRes.ok) {
        report.verdict = 'MASTER_FAILED';
        report.latencyMs = Date.now() - start;
        report.details = `Upstream CDN rejected master playlist with HTTP ${masterRes.status}`;
        return report;
      }

      const playlistText = await masterRes.text(4000);
      const finalUrl = masterRes.url || targetUrl;

      // 2. Check for audio tracks (#EXT-X-MEDIA:TYPE=AUDIO)
      const audioMatch = playlistText.match(/#EXT-X-MEDIA:TYPE=AUDIO[^\n]*URI="([^"]+)"/i);
      if (audioMatch) {
        report.audioTrackDetected = true;
        const audioUrl = new URL(audioMatch[1], finalUrl).toString();
        try {
          const audioRes = await fetchUpstream(audioUrl, { headers, timeout: 5000 });
          report.audioTrackStatus = audioRes.status;
          if (!audioRes.ok) {
            report.verdict = 'AUDIO_FAILED';
            report.latencyMs = Date.now() - start;
            report.details = `Audio playlist returned HTTP ${audioRes.status}. This causes video players to stall indefinitely.`;
            return report;
          }
        } catch (err: any) {
          report.verdict = 'AUDIO_FAILED';
          report.latencyMs = Date.now() - start;
          report.details = `Audio playlist fetch failed: ${err.message || err}`;
          return report;
        }
      }

      // 3. Find first video segment or sub-playlist
      let testSegmentUrl: string | null = null;
      const lines = playlistText.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const resolved = new URL(trimmed, finalUrl).toString();
        if (resolved.includes('.m3u8')) {
          try {
            const subRes = await fetchUpstream(resolved, { headers, timeout: 4000 });
            if (subRes.ok) {
              const subText = await subRes.text(3000);
              for (const subLine of subText.split('\n')) {
                const subTrim = subLine.trim();
                if (subTrim && !subTrim.startsWith('#')) {
                  testSegmentUrl = new URL(subTrim, subRes.url || resolved).toString();
                  break;
                }
              }
            }
          } catch {}
        } else {
          testSegmentUrl = resolved;
        }
        if (testSegmentUrl) break;
      }

      if (testSegmentUrl) {
        try {
          const segRes = await fetchUpstream(testSegmentUrl, {
            headers: { ...headers, Range: 'bytes=0-131071' },
            timeout: 5000,
          });
          report.videoChunkStatus = segRes.status;
          if (segRes.ok || segRes.status === 206) {
            const buf = await segRes.buffer(4000);
            report.videoChunkBytes = buf.length;
            report.verdict = 'READY_TO_PLAY';
            report.details = `Stream is healthy. Master playlist, audio track, and initial video segment (${buf.length} bytes) verified.`;
          } else {
            report.verdict = 'VIDEO_CHUNK_FAILED';
            report.details = `Video segment returned HTTP ${segRes.status}. Player will stall downloading video data.`;
          }
        } catch (err: any) {
          report.verdict = 'VIDEO_CHUNK_FAILED';
          report.details = `Video chunk fetch failed: ${err.message || err}`;
        }
      } else {
        report.details = 'Master playlist valid, but no video segment URLs could be parsed.';
      }

      report.latencyMs = Date.now() - start;
      return report;
    } catch (err: any) {
      report.verdict = 'TIMEOUT';
      report.latencyMs = Date.now() - start;
      report.details = `Probe exception: ${err.message || err}`;
      return report;
    }
  }
}
