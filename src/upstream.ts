import * as net from 'net';
import * as tls from 'tls';
import * as http from 'http';
import * as https from 'https';
import { Readable } from 'stream';
import { URL } from 'url';

const SOCKS_PROXY = (process.env.SOCKS_PROXY || '').trim();

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: Buffer | string;
  timeout?: number;
  redirect?: 'follow' | 'manual';
  redirectCount?: number;
  socksOnly?: boolean;
}

export interface UpstreamResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: http.IncomingHttpHeaders;
  stream: Readable;
  text: () => Promise<string>;
  buffer: () => Promise<Buffer>;
  json: () => Promise<any>;
}

/**
 * Establish a SOCKS5 TCP tunnel with domain-name resolution on the proxy side
 */
function connectSocks5(
  targetHost: string,
  targetPort: number,
  proxyHost: string,
  proxyPort: number,
  timeoutMs: number
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const socket = net.connect(proxyPort, proxyHost);

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        socket.destroy();
        reject(new Error(`SOCKS5 connect to ${targetHost}:${targetPort} timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      socket.removeAllListeners('data');
      socket.removeAllListeners('error');
    };

    let state = 0; // 0: greeting sent, awaiting auth choice; 1: auth accepted, awaiting connect reply

    socket.on('connect', () => {
      // Step 1: Greeting (VER=5, NMETHODS=1, METHOD=0 No Auth)
      socket.write(Buffer.from([0x05, 0x01, 0x00]));
    });

    socket.on('data', (chunk) => {
      if (state === 0) {
        if (chunk.length < 2 || chunk[0] !== 0x05 || chunk[1] !== 0x00) {
          if (!finished) {
            finished = true;
            cleanup();
            socket.destroy();
            return reject(new Error(`SOCKS5 proxy authentication rejected: ${chunk.toString('hex')}`));
          }
        }
        state = 1;
        // Step 2: SOCKS5 CONNECT (VER=5, CMD=1, RSV=0, ATYP=3 Domain)
        const hostBuf = Buffer.from(targetHost, 'utf8');
        const reqBuf = Buffer.alloc(4 + 1 + hostBuf.length + 2);
        reqBuf[0] = 0x05;
        reqBuf[1] = 0x01; // CONNECT
        reqBuf[2] = 0x00; // Reserved
        reqBuf[3] = 0x03; // Domain name
        reqBuf[4] = hostBuf.length;
        hostBuf.copy(reqBuf, 5);
        reqBuf.writeUInt16BE(targetPort, 5 + hostBuf.length);
        socket.write(reqBuf);
      } else if (state === 1) {
        if (chunk.length < 2 || chunk[0] !== 0x05 || chunk[1] !== 0x00) {
          if (!finished) {
            finished = true;
            cleanup();
            socket.destroy();
            const rep = chunk.length > 1 ? chunk[1] : 0xff;
            return reject(new Error(`SOCKS5 CONNECT failed to ${targetHost}:${targetPort} (status ${rep})`));
          }
        }
        // Handshake succeeded!
        if (!finished) {
          finished = true;
          cleanup();
          resolve(socket);
        }
      }
    });

    socket.on('error', (err) => {
      if (!finished) {
        finished = true;
        cleanup();
        reject(err);
      }
    });
  });
}

function wrapResponse(res: http.IncomingMessage): UpstreamResponse {
  const status = res.statusCode || 0;
  const ok = (status >= 200 && status < 300) || status === 206;
  let cachedBuf: Buffer | null = null;

  const buffer = async (): Promise<Buffer> => {
    if (cachedBuf) return cachedBuf;
    const chunks: Buffer[] = [];
    for await (const chunk of res) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    cachedBuf = Buffer.concat(chunks);
    return cachedBuf;
  };

  const text = async (): Promise<string> => {
    const b = await buffer();
    return b.toString('utf8');
  };

  const json = async (): Promise<any> => {
    const t = await text();
    return JSON.parse(t);
  };

  return {
    ok,
    status,
    statusText: res.statusMessage || '',
    headers: res.headers,
    stream: res,
    buffer,
    text,
    json,
  };
}

/**
 * Fetch URL through SOCKS5 proxy tunnel
 */
async function fetchViaSocks(urlStr: string, options: FetchOptions = {}): Promise<UpstreamResponse> {
  const targetUrl = new URL(urlStr);
  const targetHost = targetUrl.hostname;
  const isHttps = targetUrl.protocol === 'https:';
  const targetPort = targetUrl.port ? parseInt(targetUrl.port, 10) : (isHttps ? 443 : 80);

  const [proxyHost, proxyPortStr] = SOCKS_PROXY.replace(/^socks5h?:\/\//i, '').split(':');
  const proxyPort = parseInt(proxyPortStr || '40000', 10);
  const timeoutMs = options.timeout || 10000;

  const rawSocket = await connectSocks5(targetHost, targetPort, proxyHost || '127.0.0.1', proxyPort, timeoutMs);

  let transportSocket: net.Socket;
  if (isHttps) {
    transportSocket = tls.connect({
      socket: rawSocket,
      servername: targetHost,
    });
  } else {
    transportSocket = rawSocket;
  }

  return new Promise((resolve, reject) => {
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        transportSocket.destroy();
        reject(new Error(`Request to ${targetHost} timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    const client = isHttps ? https : http;
    const req = client.request({
      hostname: targetHost,
      port: targetPort,
      path: targetUrl.pathname + targetUrl.search,
      method: options.method || 'GET',
      headers: options.headers,
      createConnection: () => transportSocket,
    }, (res) => {
      clearTimeout(timer);
      if (resolved) return;
      resolved = true;

      // Handle HTTP redirects (301, 302, 303, 307, 308)
      const statusCode = res.statusCode || 0;
      if (
        options.redirect !== 'manual' &&
        [301, 302, 303, 307, 308].includes(statusCode) &&
        res.headers.location
      ) {
        const redirectCount = (options.redirectCount || 0) + 1;
        if (redirectCount <= 5) {
          res.resume();
          const nextUrl = new URL(res.headers.location, urlStr).toString();
          return resolve(fetchUpstream(nextUrl, { ...options, redirectCount }));
        }
      }

      resolve(wrapResponse(res));
    });

    req.on('error', (err) => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * Fetch URL directly without proxy
 */
async function fetchDirect(urlStr: string, options: FetchOptions = {}): Promise<UpstreamResponse> {
  const targetUrl = new URL(urlStr);
  const isHttps = targetUrl.protocol === 'https:';
  const timeoutMs = options.timeout || 10000;

  return new Promise((resolve, reject) => {
    let resolved = false;

    const client = isHttps ? https : http;
    const req = client.request(urlStr, {
      method: options.method || 'GET',
      headers: options.headers,
    }, (res) => {
      clearTimeout(timer);
      if (resolved) return;
      resolved = true;

      const statusCode = res.statusCode || 0;
      if (
        options.redirect !== 'manual' &&
        [301, 302, 303, 307, 308].includes(statusCode) &&
        res.headers.location
      ) {
        const redirectCount = (options.redirectCount || 0) + 1;
        if (redirectCount <= 5) {
          res.resume();
          const nextUrl = new URL(res.headers.location, urlStr).toString();
          return resolve(fetchUpstream(nextUrl, { ...options, redirectCount }));
        }
      }

      resolve(wrapResponse(res));
    });

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        req.destroy(new Error(`Direct request to ${targetUrl.hostname} timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    req.on('error', (err) => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * Universal upstream fetcher:
 * Automatically uses SOCKS5 proxy if SOCKS_PROXY is configured.
 * Falls back to direct connection if proxy fails (unless socksOnly is true).
 */
export async function fetchUpstream(urlStr: string, options: FetchOptions = {}): Promise<UpstreamResponse> {
  if (SOCKS_PROXY) {
    try {
      return await fetchViaSocks(urlStr, options);
    } catch (err: any) {
      if (options.socksOnly) {
        throw err;
      }
      console.warn(`[Proxy Fallback] SOCKS proxy failed for ${urlStr}: ${err.message}. Retrying direct...`);
    }
  }
  return fetchDirect(urlStr, options);
}
