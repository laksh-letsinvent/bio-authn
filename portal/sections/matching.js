// BUILD_MODE: "public" = real face images; "local" = identity-tile placeholders
const BUILD_MODE = "public";

const THRESHOLD = 0.298;
const BAND_LO   = 0.228;  // THRESHOLD - 0.07
const BAND_HI   = 0.368;  // THRESHOLD + 0.07
const SCORE_MIN = -0.19;
const SCORE_MAX =  0.89;

// Chart.js palettes — canvas can't read CSS vars, hold both themes here
const CHART_PALETTE = {
  dark:  { accept:'#34D399', reject:'#FB7185', uncertain:'#FBBF24', primary:'#38BDF8', grid:'#222A37', text:'#9BA6B5' },
  light: { accept:'#059669', reject:'#E11D48', uncertain:'#D97706', primary:'#0284C7', grid:'#E2E8F0', text:'#475569' },
};
const HEATMAP_RAMP = {
  dark:  ['#16222E','#1E3A52','#2A6FA0','#38BDF8','#7DD3FC'],
  light: ['#E6F1FB','#B5D4F4','#7DB1E8','#2A86D6','#0284C7'],
};
const EMB_PALETTE = {
  dark:  ['#38BDF8','#818CF8','#34D399','#FB7185','#FBBF24','#7C3AED','#DB2777','#0891B2','#65A30D','#EA580C','#9333EA','#16A34A'],
  light: ['#0284C7','#6366F1','#059669','#E11D48','#D97706','#7C3AED','#DB2777','#0891B2','#65A30D','#EA580C','#9333EA','#16A34A'],
};

function curTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}
function pal() { return CHART_PALETTE[curTheme()]; }

let matchExamples = [];
let pairScores    = [];
let embMap        = null;
let currentIdx    = 0;
let histChart     = null;
let embMapChart   = null;
let sliderFarEl, sliderFrrEl, sliderThrEl;

// ── heatmap colour: norm is 0–1 (low to high); uses cyan ramp per theme
function heatColour(norm) {
  const r = HEATMAP_RAMP[curTheme()];
  if (norm < 0.2) return r[0];
  if (norm < 0.4) return r[1];
  if (norm < 0.6) return r[2];
  if (norm < 0.8) return r[3];
  return r[4];
}

function renderHeatmap(containerId, values64, label) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  wrap.innerHTML = `<div class="heatmap-label">${label}</div><div class="heatmap-strip" id="${containerId}-strip"></div>`;
  const strip = document.getElementById(containerId + '-strip');
  const min = Math.min(...values64), max = Math.max(...values64);
  values64.forEach(v => {
    const norm = max === min ? 0.5 : (v - min) / (max - min);
    const cell = document.createElement('div');
    cell.className = 'heatmap-cell';
    cell.style.background = heatColour(norm);
    cell.title = v.toFixed(4);
    strip.appendChild(cell);
  });
}

function scoreClass(score) {
  if (score >= BAND_HI) return 'accept';
  if (score <= BAND_LO) return 'reject';
  return 'uncertain';
}

function scoreZoneLabel(score) {
  if (score >= THRESHOLD) return score >= BAND_HI ? 'Accept ✓' : 'Uncertain band — above threshold';
  return score <= BAND_LO ? 'Reject ✗' : 'Uncertain band — below threshold';
}

function renderNumberLine(score) {
  const wrap = document.getElementById('nl-wrap');
  if (!wrap) return;

  const range = SCORE_MAX - SCORE_MIN;
  const pctReject  = ((BAND_LO  - SCORE_MIN) / range * 100).toFixed(2);
  const pctUncert  = ((BAND_HI  - BAND_LO)  / range * 100).toFixed(2);
  const pctAccept  = ((SCORE_MAX - BAND_HI)  / range * 100).toFixed(2);
  const markerPct  = ((score - SCORE_MIN) / range * 100).toFixed(2);
  const markerZone = scoreClass(score);

  wrap.innerHTML = `
    <div class="number-line-label">Similarity score on the threshold number line (threshold = ${THRESHOLD.toFixed(3)})</div>
    <div class="number-line" id="nl-bar">
      <div class="nl-zone nl-reject"   style="width:${pctReject}%">Reject</div>
      <div class="nl-zone nl-uncertain"style="width:${pctUncert}%">Uncertain band</div>
      <div class="nl-zone nl-accept"   style="width:${pctAccept}%">Accept</div>
      <div class="nl-marker nl-marker--${markerZone}" id="nl-marker" style="left:${markerPct}%">
        <div class="nl-marker-dot"></div>
        <div class="nl-marker-label">${score.toFixed(4)}</div>
      </div>
    </div>
    <div class="nl-ticks">
      <span>${SCORE_MIN.toFixed(2)}</span>
      <span>${BAND_LO.toFixed(3)} ← band lo</span>
      <span>${THRESHOLD.toFixed(3)} ← thr</span>
      <span>${BAND_HI.toFixed(3)} ← band hi</span>
      <span>${SCORE_MAX.toFixed(2)}</span>
    </div>
  `;
}

function renderExample(idx) {
  const ex = matchExamples[idx];
  if (!ex) return;
  currentIdx = idx;

  // update button states
  document.querySelectorAll('.ex-btn').forEach((b, i) => {
    b.classList.toggle('btn-primary', i === idx);
    b.classList.toggle('btn-ghost',   i !== idx);
  });

  const cls = scoreClass(ex.score);
  const zone = scoreZoneLabel(ex.score);

  // face images or placeholders
  const refSrc   = BUILD_MODE === 'public' ? ex.ref_image   : null;
  const probeSrc = BUILD_MODE === 'public' ? ex.probe_image : null;
  const refImg   = refSrc   ? `<img src="${refSrc}"   alt="Reference face">`
                            : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-size:var(--text-xs);color:var(--text-2)">ID ${ex.pair_id?.split('_')[1] || '?'}<br>ref</div>`;
  const probeImg = probeSrc ? `<img src="${probeSrc}" alt="Probe face">`
                            : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-size:var(--text-xs);color:var(--text-2)">ID ${ex.pair_id?.split('_')[2] || '?'}<br>probe</div>`;

  document.getElementById('face-pair-display').innerHTML = `
    <div class="face-pair">
      <div class="face-card">
        <div class="face-img-wrap">${refImg}</div>
        <div class="face-label">Reference image</div>
      </div>
      <div class="face-card">
        <div class="face-img-wrap">${probeImg}</div>
        <div class="face-label">Probe image</div>
      </div>
    </div>
    <div class="score-display">
      <div class="score-value ${cls}">${ex.score.toFixed(4)}</div>
      <div class="score-label">Cosine similarity · ${zone}</div>
      <div class="decision-badge">
        <span class="badge badge-${ex.label}">${ex.label.toUpperCase()}</span>
      </div>
    </div>
  `;

  renderHeatmap('heatmap-ref',   ex.ref_embedding_64,   'Reference embedding (64 mean-pooled dimensions)');
  renderHeatmap('heatmap-probe', ex.probe_embedding_64, 'Probe embedding (64 mean-pooled dimensions)');
  renderNumberLine(ex.score);
}

// ── compute FAR + FRR for a given threshold from pairScores
function computeFarFrr(thr) {
  let fp = 0, tp = 0, fn = 0, tn = 0;
  pairScores.forEach(p => {
    const accept = p.score >= thr;
    if (p.label === 'impostor') { accept ? fp++ : tn++; }
    else                        { accept ? tp++ : fn++; }
  });
  const nImp = fp + tn;
  const nGen = tp + fn;
  const far  = nImp > 0 ? fp / nImp : 0;
  const frr  = nGen > 0 ? fn / nGen : 0;
  return { far, frr };
}

function updateSlider(thr) {
  const { far, frr } = computeFarFrr(thr);
  if (sliderFarEl) sliderFarEl.textContent = (far * 100).toFixed(2) + '%';
  if (sliderFrrEl) sliderFrrEl.textContent = (frr * 100).toFixed(2) + '%';
  if (sliderThrEl) sliderThrEl.textContent = (+thr).toFixed(3);
}

function buildHistogram() {
  const p = pal();
  const genuine  = pairScores.filter(s => s.label === 'genuine').map(s => s.score);
  const impostor = pairScores.filter(s => s.label === 'impostor').map(s => s.score);

  const bins = 60;
  const lo = -0.2, hi = 0.9;
  const step = (hi - lo) / bins;
  const labels = Array.from({ length: bins }, (_, i) => (lo + i * step + step / 2).toFixed(2));

  function histogram(data) {
    const counts = new Array(bins).fill(0);
    data.forEach(v => {
      const i = Math.min(bins - 1, Math.floor((v - lo) / step));
      if (i >= 0) counts[i]++;
    });
    return counts;
  }

  const genCounts = histogram(genuine);
  const impCounts = histogram(impostor);

  const ctx = document.getElementById('hist-canvas').getContext('2d');
  if (histChart) histChart.destroy();
  histChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Genuine pairs',
          data: genCounts,
          backgroundColor: p.accept + '99',
          borderColor: p.accept,
          borderWidth: 1,
        },
        {
          label: 'Impostor pairs',
          data: impCounts,
          backgroundColor: p.reject + '99',
          borderColor: p.reject,
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { color: p.text, font: { size: 12 } } },
        tooltip: { callbacks: { title: a => `Score ≈ ${a[0].label}` } },
        annotation: undefined,
      },
      scales: {
        x: {
          stacked: false,
          ticks: { color: p.text, maxTicksLimit: 10 },
          grid: { color: p.grid },
          title: { display: true, text: 'Cosine Similarity', color: p.text },
        },
        y: {
          ticks: { color: p.text },
          grid: { color: p.grid },
          title: { display: true, text: 'Pair Count', color: p.text },
        },
      },
    },
    plugins: [{
      id: 'threshold-line',
      afterDraw(chart) {
        const { ctx: c, scales: { x, y } } = chart;
        const thr = parseFloat(document.getElementById('thr-slider')?.value ?? THRESHOLD);
        const binIdx = Math.round((thr - lo) / step);
        const xPos = x.getPixelForValue(binIdx);
        c.save();
        c.strokeStyle = pal().text;
        c.lineWidth = 2;
        c.setLineDash([4, 4]);
        c.beginPath();
        c.moveTo(xPos, y.top);
        c.lineTo(xPos, y.bottom);
        c.stroke();
        c.restore();
      },
    }],
  });
}

function buildEmbeddingMap() {
  if (!embMap) return;
  const canvas = document.getElementById('emb-map-canvas');
  if (!canvas) return;

  const p = pal();
  const ctx = canvas.getContext('2d');
  if (embMapChart) embMapChart.destroy();

  const colourToggle = document.getElementById('emb-colour-toggle');
  const mode = colourToggle ? colourToggle.value : 'identity';

  const palette = EMB_PALETTE[curTheme()];
  const colours = {};
  const uniqueIds = [...new Set(embMap.points.map(pt => pt.identity))];

  embMap.points.forEach(pt => {
    if (mode === 'gender') {
      colours[pt.identity] = pt.gender === 'Female' ? p.reject : p.primary;
    } else {
      const i = uniqueIds.indexOf(pt.identity) % palette.length;
      colours[pt.identity] = palette[i];
    }
  });

  embMapChart = new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: [{
        label: 'Identity embeddings (PCA 2D)',
        data: embMap.points.map(pt => ({ x: pt.x, y: pt.y, identity: pt.identity, gender: pt.gender })),
        backgroundColor: embMap.points.map(pt => colours[pt.identity] + 'CC'),
        pointRadius: 6,
        pointHoverRadius: 9,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const d = ctx.raw;
              return `ID ${d.identity} · ${d.gender} · (${d.x.toFixed(2)}, ${d.y.toFixed(2)})`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: p.text }, grid: { color: p.grid }, title: { display: true, text: `PC1 (${(embMap.explained_variance[0]*100).toFixed(1)}% variance)`, color: p.text } },
        y: { ticks: { color: p.text }, grid: { color: p.grid }, title: { display: true, text: `PC2 (${(embMap.explained_variance[1]*100).toFixed(1)}% variance)`, color: p.text } },
      },
    },
  });
}

// ── Main init
async function initMatching() {
  const root = document.getElementById('matching-content');

  root.innerHTML = `<div style="color:var(--text-2);font-size:var(--text-sm);">Loading data…</div>`;

  try {
    [matchExamples, pairScores, embMap] = await Promise.all([
      fetch('data/matching_examples.json').then(r => r.json()),
      fetch('data/pair_scores.json').then(r => r.json()),
      fetch('data/embedding_map.json').then(r => r.json()),
    ]);
  } catch (e) {
    root.innerHTML = `<div class="callout callout-warn"><strong>Could not load data files.</strong> Serve this portal with <code>python -m http.server</code> from the <code>portal/</code> directory. ${e.message}</div>`;
    return;
  }

  // ── Button row for switching examples
  const btnLabels = matchExamples.map((ex, i) => {
    const cls = ex.label === 'genuine' ? 'G' : 'I';
    return `<button class="btn btn-ghost ex-btn" data-idx="${i}" title="${ex.pair_id}">${cls}${i+1} · ${ex.score.toFixed(3)}</button>`;
  });

  root.innerHTML = `
    <!-- Step 1: Pair picker -->
    <div class="card" style="margin-bottom:var(--space-5);">
      <h3 style="margin-top:0;">Step 1 — Pick an example pair</h3>
      <p style="color:var(--text-2);font-size:var(--text-sm);margin-bottom:var(--space-4);">
        G = genuine (same person), I = impostor (different people). Score shown is ArcFace cosine similarity.
      </p>
      <div class="btn-group" style="margin-bottom:var(--space-5);">
        ${btnLabels.join('')}
      </div>
      <div id="face-pair-display"></div>
    </div>

    <!-- Step 2: Embeddings -->
    <div class="card" style="margin-bottom:var(--space-5);">
      <h3 style="margin-top:0;">Step 2 — The embeddings</h3>
      <p style="color:var(--text-2);font-size:var(--text-sm);margin-bottom:var(--space-4);">
        ArcFace maps each face to a 512-dimensional unit vector. The colour encodes each dimension's value.
        Same-person embeddings look similar; different-person embeddings look distinct.
      </p>
      <div id="heatmap-ref" style="margin-bottom:var(--space-4);"></div>
      <div id="heatmap-probe"></div>
      <div class="callout callout-info" style="margin-top:var(--space-4);">
        <strong>What you're seeing:</strong> each cell is the mean of 8 raw dimensions. Darker = lower activation, brighter cyan = higher.
        The full 512-d vectors are included in <code>data/matching_examples.json</code> if you want to compute the exact cosine yourself.
      </div>
    </div>

    <!-- Step 3: Number line -->
    <div class="card" style="margin-bottom:var(--space-5);">
      <h3 style="margin-top:0;">Step 3 — The threshold decision</h3>
      <p style="color:var(--text-2);font-size:var(--text-sm);margin-bottom:var(--space-4);">
        Cosine similarity runs from −1 (opposite) to 1 (identical). The operating threshold (<strong>${THRESHOLD}</strong>)
        was tuned to ArcFace FAR ≈ 1%. Scores in the uncertain band (${BAND_LO.toFixed(3)}–${BAND_HI.toFixed(3)})
        are where the VLM second-opinion is most valuable.
      </p>
      <div id="nl-wrap"></div>
    </div>

    <!-- Enrichments: 2D map -->
    <div class="card" style="margin-bottom:var(--space-5);">
      <h3 style="margin-top:0;">Enrichment — 2D embedding space</h3>
      <p style="color:var(--text-2);font-size:var(--text-sm);margin-bottom:var(--space-4);">
        One point per identity (mean of 6 images). PCA collapses the 512-d space to 2 dimensions —
        clusters of nearby points are identities the model treats as similar.
      </p>
      <div style="display:flex;align-items:center;gap:var(--space-4);margin-bottom:var(--space-3);">
        <label style="font-size:var(--text-sm);color:var(--text-2);">Colour by:</label>
        <select id="emb-colour-toggle" style="font-size:var(--text-sm);padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);">
          <option value="identity">Identity (cycling palette)</option>
          <option value="gender">Gender (blue = Male, red = Female)</option>
        </select>
      </div>
      <div class="chart-wrap" style="height:340px;">
        <canvas id="emb-map-canvas"></canvas>
      </div>
    </div>

    <!-- Enrichments: Threshold slider + histogram -->
    <div class="card" style="margin-bottom:var(--space-5);">
      <h3 style="margin-top:0;">Enrichment — Live threshold explorer</h3>
      <p style="color:var(--text-2);font-size:var(--text-sm);margin-bottom:var(--space-4);">
        Drag the threshold. FAR and FRR trade off: lower threshold → more accepts → FAR rises. Operating point is where they cross (EER ≈ 1.5%).
      </p>
      <div class="slider-row">
        <span style="font-size:var(--text-sm);color:var(--text-2);min-width:80px;">Threshold</span>
        <input type="range" id="thr-slider" min="-0.19" max="0.89" step="0.005" value="${THRESHOLD}">
        <span class="slider-val" id="thr-val">${THRESHOLD.toFixed(3)}</span>
      </div>
      <div class="grid-2" style="margin-bottom:var(--space-4);">
        <div class="metric-card">
          <div class="metric-label">FAR — False Accept Rate</div>
          <div class="metric-value" id="slider-far-val" style="color:var(--reject);">—</div>
          <div class="metric-sub">Impostor pairs incorrectly accepted</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">FRR — False Reject Rate</div>
          <div class="metric-value" id="slider-frr-val" style="color:var(--uncertain);">—</div>
          <div class="metric-sub">Genuine pairs incorrectly rejected</div>
        </div>
      </div>

      <h4>Score distributions — genuine vs impostor</h4>
      <p style="color:var(--text-2);font-size:var(--text-sm);margin-bottom:var(--space-3);">
        The overlap region is where errors happen. The threshold line moves with the slider.
      </p>
      <div class="chart-wrap">
        <canvas id="hist-canvas"></canvas>
      </div>
    </div>

    <div class="attribution">
      Corpus: <a href="https://github.com/microsoft/DigiFace1M" target="_blank" rel="noopener">DigiFace-1M</a>
      (Microsoft) — synthetic faces, non-commercial research use (R-UDA).
      Images shown are illustrative examples from the eval corpus; no bulk download provided.
    </div>
  `;

  // wire example buttons
  document.querySelectorAll('.ex-btn').forEach(btn => {
    btn.addEventListener('click', () => renderExample(+btn.dataset.idx));
  });

  // wire threshold slider
  const slider    = document.getElementById('thr-slider');
  const thrValEl  = document.getElementById('thr-val');
  sliderFarEl = document.getElementById('slider-far-val');
  sliderFrrEl = document.getElementById('slider-frr-val');

  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    thrValEl.textContent = v.toFixed(3);
    updateSlider(v);
    if (histChart) histChart.update();
  });

  // wire colour toggle
  document.getElementById('emb-colour-toggle').addEventListener('change', buildEmbeddingMap);

  // initial render
  renderExample(0);
  updateSlider(THRESHOLD);
  buildHistogram();
  buildEmbeddingMap();
}

// Re-render all charts and heatmaps when theme changes
window.__matchingRerender = function() {
  if (matchExamples[currentIdx]) {
    renderHeatmap('heatmap-ref',   matchExamples[currentIdx].ref_embedding_64,   'Reference embedding (64 mean-pooled dimensions)');
    renderHeatmap('heatmap-probe', matchExamples[currentIdx].probe_embedding_64, 'Probe embedding (64 mean-pooled dimensions)');
  }
  if (histChart) buildHistogram();
  if (embMapChart) buildEmbeddingMap();
};
