import { IStreamProvider, MediaTarget, ResolvedMetadata, StremioStream } from '../types';
import { resolveMetadata } from '../metadata';
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
}
