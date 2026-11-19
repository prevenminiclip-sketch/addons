export interface MediaTarget {
  type: 'movie' | 'series';
  imdbId?: string;
  tmdbId?: number;
  season?: number;
  episode?: number;
}

export interface ResolvedMetadata {
  tmdbId: number;
  imdbId: string;
  title: string;
  year: string;
}

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

export interface IStreamProvider {
  readonly name: string;
  getStreams(
    target: MediaTarget,
    meta: ResolvedMetadata,
    baseUrl: string,
    accessKey?: string,
  ): Promise<StremioStream[]>;
}
