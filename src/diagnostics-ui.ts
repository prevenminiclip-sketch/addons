import { DiagnosticsReport, StreamProbeReport } from './providers/manager';

export function renderDiagnosticsHtml(options: {
  report: DiagnosticsReport;
  baseUrl: string;
  probeReport?: StreamProbeReport;
  targetId: string;
  targetType: string;
  activeProvider: string;
}): string {
  const { report, baseUrl, probeReport, targetId, targetType, activeProvider } = options;
  const meta = report.resolvedMetadata;

  const quickLinks = [
    { label: 'Inception (Movie)', id: 'tt1375666', type: 'movie' },
    { label: 'Breaking Bad S01E01 (Series)', id: 'tt0903747:1:1', type: 'series' },
    { label: 'Fight Club (Movie)', id: 'tt0137523', type: 'movie' },
    { label: 'Interstellar (Movie)', id: 'tt0816692', type: 'movie' },
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Movy Multi-Source Diagnostics</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --card-border: #30363d;
      --text: #c9d1d9;
      --heading: #f0f6fc;
      --green: #2ea043;
      --green-bg: rgba(46, 160, 67, 0.15);
      --red: #f85149;
      --red-bg: rgba(248, 81, 73, 0.15);
      --yellow: #d29922;
      --yellow-bg: rgba(210, 153, 34, 0.15);
      --blue: #58a6ff;
      --blue-bg: rgba(88, 166, 255, 0.15);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      padding: 24px 16px;
      line-height: 1.5;
    }
    .container { max-width: 1040px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 24px;
      flex-wrap: wrap;
      gap: 12px;
    }
    h1 { color: var(--heading); font-size: 24px; font-weight: 600; }
    .badge-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
    }
    .status-ok { background: var(--green-bg); color: var(--green); border: 1px solid var(--green); }
    .status-empty { background: var(--yellow-bg); color: var(--yellow); border: 1px solid var(--yellow); }
    .status-error, .status-timeout { background: var(--red-bg); color: var(--red); border: 1px solid var(--red); }
    
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .card-title {
      font-size: 17px;
      color: var(--heading);
      font-weight: 600;
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    
    /* Search Bar */
    .search-bar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
    input[type="text"] {
      flex: 1;
      min-width: 220px;
      background: #0d1117;
      border: 1px solid var(--card-border);
      color: var(--heading);
      padding: 9px 14px;
      border-radius: 6px;
      font-size: 14px;
    }
    input[type="text"]:focus { outline: none; border-color: var(--blue); }
    select {
      background: #0d1117;
      border: 1px solid var(--card-border);
      color: var(--heading);
      padding: 9px 12px;
      border-radius: 6px;
      font-size: 14px;
    }
    button, .btn {
      background: #238636;
      color: #fff;
      border: none;
      padding: 9px 16px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    button:hover, .btn:hover { background: #2ea043; }
    .btn-secondary {
      background: #21262d;
      color: var(--text);
      border: 1px solid var(--card-border);
    }
    .btn-secondary:hover { background: #30363d; color: var(--heading); }

    .quick-links { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
    .quick-chip {
      background: #21262d;
      color: var(--blue);
      border: 1px solid var(--card-border);
      padding: 4px 10px;
      border-radius: 16px;
      font-size: 12px;
      text-decoration: none;
    }
    .quick-chip:hover { border-color: var(--blue); }

    /* Provider Grid */
    .provider-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
      margin-top: 14px;
    }
    .provider-card {
      background: #0d1117;
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .p-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .p-name { font-weight: 600; color: var(--heading); font-size: 16px; }
    .p-metric { font-size: 26px; font-weight: 700; color: var(--heading); }
    .p-sub { font-size: 12px; color: #8b949e; margin-top: 4px; }
    .p-error {
      background: var(--red-bg);
      color: var(--red);
      font-size: 12px;
      padding: 8px;
      border-radius: 4px;
      margin-top: 10px;
      border: 1px solid rgba(248, 81, 73, 0.3);
      word-break: break-word;
    }
    .p-sample {
      background: #161b22;
      border: 1px solid var(--card-border);
      font-size: 11px;
      padding: 6px 8px;
      border-radius: 4px;
      margin-top: 10px;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Probe Section */
    .probe-box {
      background: #0d1117;
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 16px;
      margin-top: 12px;
    }
    .probe-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #21262d;
      font-size: 13px;
    }
    .probe-row:last-child { border-bottom: none; }
    .probe-label { color: #8b949e; }
    .probe-val { font-weight: 600; color: var(--heading); }

    /* Stremio Links Table */
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 10px; }
    th, td { text-align: left; padding: 10px; border-bottom: 1px solid var(--card-border); }
    th { color: #8b949e; font-weight: 600; }
    td code { background: #0d1117; padding: 2px 6px; border-radius: 4px; color: var(--blue); }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>Movy Multi-Source Diagnostics</h1>
        <div style="font-size: 13px; color: #8b949e; margin-top: 4px;">
          Direct Stream Diagnostics, HLS Playback Prober & Provider Health
        </div>
      </div>
      <div>
        <a href="${baseUrl}/manifest.json" class="btn btn-secondary">Addon Manifest</a>
        <a href="?id=${targetId}&type=${targetType}&format=json" class="btn btn-secondary">Raw JSON API</a>
      </div>
    </header>

    <!-- SECTION 1: SEARCH & TEST -->
    <div class="card">
      <div class="card-title">
        <span>🔎 Provider Test Query</span>
        <span style="font-size: 13px; color: #8b949e;">Resolution: ${report.metadataLatencyMs}ms</span>
      </div>

      <form method="GET" action="" class="search-bar">
        <input type="text" name="id" value="${targetId}" placeholder="Enter IMDb ID (e.g. tt1375666) or TMDB ID" required>
        <select name="type">
          <option value="movie" ${targetType === 'movie' ? 'selected' : ''}>Movie</option>
          <option value="series" ${targetType === 'series' ? 'selected' : ''}>Series</option>
        </select>
        <button type="submit">Run Diagnostics</button>
      </form>

      <div class="quick-links">
        <span style="font-size: 12px; color: #8b949e; align-self: center;">Quick Tests:</span>
        ${quickLinks
          .map(
            (q) =>
              `<a href="?id=${encodeURIComponent(q.id)}&type=${q.type}" class="quick-chip">${q.label}</a>`
          )
          .join('')}
      </div>

      ${
        meta
          ? `
        <div style="margin-top: 16px; padding: 12px; background: #0d1117; border-radius: 6px; border: 1px solid var(--card-border); font-size: 14px;">
          <strong>Target Media:</strong> <span style="color: var(--heading);">${meta.title} (${meta.year})</span>
          &nbsp;•&nbsp; <strong>IMDb:</strong> <code>${meta.imdbId || 'N/A'}</code>
          &nbsp;•&nbsp; <strong>TMDB ID:</strong> <code>${meta.tmdbId || 'N/A'}</code>
          &nbsp;•&nbsp; <strong>Total Streams Found:</strong> <strong style="color: var(--green);">${report.totalStreams}</strong>
        </div>
      `
          : `
        <div style="margin-top: 16px; padding: 12px; background: var(--red-bg); border-radius: 6px; border: 1px solid var(--red); color: var(--red); font-size: 14px;">
          ❌ <strong>Metadata Resolution Failed:</strong> Could not resolve IMDb/TMDB ID. Check internet connection or ID format.
        </div>
      `
      }
    </div>

    <!-- SECTION 2: PROVIDER HEALTH STATUS MATRIX -->
    <div class="card">
      <div class="card-title">
        <span>📡 Provider Status & Links Breakdown</span>
        <span style="font-size: 13px; color: #8b949e;">Checked in Parallel</span>
      </div>

      <div class="provider-grid">
        ${report.providers
          .map((p) => {
            const statusClass =
              p.status === 'OK'
                ? 'status-ok'
                : p.status === 'EMPTY'
                ? 'status-empty'
                : 'status-error';
            return `
            <div class="provider-card">
              <div>
                <div class="p-header">
                  <div class="p-name">${p.name}</div>
                  <span class="badge-status ${statusClass}">${p.status}</span>
                </div>
                <div class="p-metric">${p.streamCount} <span style="font-size: 14px; font-weight: normal; color: #8b949e;">streams</span></div>
                <div class="p-sub">Query Latency: <strong>${p.latencyMs} ms</strong></div>
                ${p.error ? `<div class="p-error">⚠️ ${p.error}</div>` : ''}
              </div>
              <div>
                ${
                  p.firstStreamTitle
                    ? `<div class="p-sample" title="${p.firstStreamTitle}">Top: ${p.firstStreamTitle}</div>`
                    : ''
                }
                ${
                  p.firstStreamUrl
                    ? `<a href="?probeUrl=${encodeURIComponent(
                        p.firstStreamUrl
                      )}" class="btn btn-secondary" style="width: 100%; margin-top: 10px; justify-content: center; font-size: 12px; padding: 6px;">Probe Stream Playback</a>`
                    : ''
                }
              </div>
            </div>
          `;
          })
          .join('')}
      </div>
    </div>

    <!-- SECTION 3: STREAM PROBE & PLAYBACK HEALTH -->
    <div class="card">
      <div class="card-title">
        <span>🎬 Stream Playback & Stall Inspector</span>
        <span style="font-size: 13px; color: #8b949e;">Diagnose "Loads and Not Play"</span>
      </div>
      <p style="font-size: 13px; color: #8b949e; margin-bottom: 12px;">
        Test any direct stream URL or proxied HLS stream to verify master playlist parsing, audio track resolution, and initial segment chunk download.
      </p>

      <form method="GET" action="" class="search-bar">
        <input type="hidden" name="id" value="${targetId}">
        <input type="hidden" name="type" value="${targetType}">
        <input type="text" name="probeUrl" value="${probeReport?.targetUrl || ''}" placeholder="Paste stream URL or click 'Probe Stream Playback' on any card above" required>
        <button type="submit" class="btn btn-secondary">Probe Playback</button>
      </form>

      ${
        probeReport
          ? `
        <div class="probe-box">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <div style="font-weight: 600; color: var(--heading);">Probe Result</div>
            <span class="badge-status ${
              probeReport.verdict === 'READY_TO_PLAY' ? 'status-ok' : 'status-error'
            }">
              ${probeReport.verdict}
            </span>
          </div>

          <div class="probe-row">
            <span class="probe-label">Verdict & Summary:</span>
            <span class="probe-val" style="color: ${
              probeReport.verdict === 'READY_TO_PLAY' ? 'var(--green)' : 'var(--red)'
            };">${probeReport.details}</span>
          </div>
          <div class="probe-row">
            <span class="probe-label">Master Playlist HTTP Status:</span>
            <span class="probe-val">${probeReport.masterStatus || 'N/A'} (${probeReport.masterContentType || 'N/A'})</span>
          </div>
          <div class="probe-row">
            <span class="probe-label">Audio Track Playlist:</span>
            <span class="probe-val">${
              probeReport.audioTrackDetected
                ? `Detected (HTTP ${probeReport.audioTrackStatus || 'Failed'})`
                : 'Muxed Audio (Standard)'
            }</span>
          </div>
          <div class="probe-row">
            <span class="probe-label">First Video Segment Chunk:</span>
            <span class="probe-val">${
              probeReport.videoChunkStatus
                ? `HTTP ${probeReport.videoChunkStatus} (${probeReport.videoChunkBytes || 0} bytes)`
                : 'Not Checked'
            }</span>
          </div>
          <div class="probe-row">
            <span class="probe-label">Probe Execution Latency:</span>
            <span class="probe-val">${probeReport.latencyMs} ms</span>
          </div>
        </div>
      `
          : ''
      }
    </div>

    <!-- SECTION 4: MODULAR STREMIO ADDON TABS -->
    <div class="card">
      <div class="card-title">
        <span>📱 Stremio Modular Addon Manifests</span>
        <span style="font-size: 13px; color: #8b949e;">Install as Separate Tabs</span>
      </div>
      <p style="font-size: 13px; color: #8b949e;">
        To check providers simultaneously and see them in separate tabs in Stremio (like Premiumize), install these manifest URLs:
      </p>

      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Stremio Tab Name</th>
            <th>Direct Manifest URL</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Movy</strong></td>
            <td><code>Movy</code></td>
            <td><code>${baseUrl}/movy/manifest.json</code></td>
          </tr>
          <tr>
            <td><strong>Hexa (4K)</strong></td>
            <td><code>Hexa (4K)</code></td>
            <td><code>${baseUrl}/hexa/manifest.json</code></td>
          </tr>
          <tr>
            <td><strong>MovieBox</strong></td>
            <td><code>MovieBox</code></td>
            <td><code>${baseUrl}/moviebox/manifest.json</code></td>
          </tr>
          <tr>
            <td><strong>Rivestream</strong></td>
            <td><code>Rivestream</code></td>
            <td><code>${baseUrl}/rivestream/manifest.json</code></td>
          </tr>
          <tr>
            <td><strong>All Providers Combined</strong></td>
            <td><code>Movy (All Providers)</code></td>
            <td><code>${baseUrl}/manifest.json</code></td>
          </tr>
        </tbody>
      </table>
    </div>

  </div>
</body>
</html>`;
}
