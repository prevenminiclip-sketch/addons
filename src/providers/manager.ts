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
  private primaryProvider: IStreamProvider;
  private secondaryProviders: IStreamProvider[];

  constructor() {
    // Movy is the primary provider (always ranked first)
    this.primaryProvider = new MovyProvider();

    // Additional direct providers running in parallel
    this.secondaryProviders = [
      new HexaProvider(),
      new MovieBoxProvider(),
      new RivestreamProvider(),
    ];
  }

  public async getStreams(
    target: MediaTarget,
    baseUrl: string,
    accessKey?: string
  ): Promise<StremioStream[]> {
    // 1. Resolve metadata once for all providers
    const meta: ResolvedMetadata | null = await resolveMetadata(target);
    if (!meta) {
      console.warn(`[ProviderManager] Unable to resolve metadata for target:`, target);
      return [];
    }

    const PROVIDER_TIMEOUT_MS = 6500;

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

    // Rank secondary streams: 4K > 1080p > 720p > Auto > 480p
    secondaryStreams.sort((a, b) => {
      const score = (s: StremioStream) => {
        const n = s.name.toUpperCase();
        if (n.includes('[4K]') || n.includes('2160')) return 400;
        if (n.includes('[1080P]')) return 300;
        if (n.includes('[720P]')) return 200;
        if (n.includes('[AUTO]')) return 150;
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
