// Chart.js palettes — canvas cannot read CSS vars, hold both themes
const F_PALETTE = {
  dark:  { accept:'#34D399', reject:'#FB7185', uncertain:'#FBBF24', primary:'#38BDF8', grid:'#222A37', text:'#9BA6B5' },
  light: { accept:'#059669', reject:'#E11D48', uncertain:'#D97706', primary:'#0284C7', grid:'#E2E8F0', text:'#475569' },
};
function fTheme() { return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }
function fpal() { return F_PALETTE[fTheme()]; }

// stored for re-render on theme toggle
let _arcface = null, _insightface = null, _vlm = null, _padBaseline = null, _padVlm = null, _opThr = 0.298;

const findingsCharts = {};

function destroyChart(id) {
  if (findingsCharts[id]) {
    findingsCharts[id].destroy();
    delete findingsCharts[id];
  }
}

async function initFindings() {
  const root = document.getElementById('findings-content');
  root.innerHTML = `<div style="color:var(--text-2);font-size:var(--text-sm);">Loading eval results…</div>`;

  let data;
  try {
    data = await fetch('data/eval_run.json').then(r => r.json());
  } catch (e) {
    root.innerHTML = `<div class="callout callout-warn"><strong>Could not load eval_run.json.</strong> Serve with <code>python -m http.server</code> from the <code>portal/</code> directory. ${e.message}</div>`;
    return;
  }

  const arcface     = data.matchers.find(m => m.matcher_id === 'arcface');
  const insightface = data.matchers.find(m => m.matcher_id === 'insightface');
  const vlm         = data.matchers.find(m => m.matcher_id === 'vlm_claude');
  const padBaseline = data.matchers.find(m => m.matcher_id === 'pad_baseline');
  const padVlm      = data.matchers.find(m => m.matcher_id === 'pad_vlm');
  const dis         = data.disagreement;
  const thr         = arcface?.operating_threshold ?? 0.298;

  // store for theme re-render
  _arcface = arcface; _insightface = insightface; _vlm = vlm;
  _padBaseline = padBaseline; _padVlm = padVlm; _opThr = thr;

  // KPI strip
  const af = arcface?.overall ?? {};
  const kpis = [
    { label: 'ArcFace EER',         value: af.eer != null ? (af.eer * 100).toFixed(2) + '%' : '—',   sub: 'Equal Error Rate' },
    { label: 'ArcFace FAR @ thr',   value: af.far != null ? (af.far * 100).toFixed(2) + '%' : '—',   sub: `thr = ${thr.toFixed(3)}` },
    { label: 'ArcFace FRR @ thr',   value: af.frr != null ? (af.frr * 100).toFixed(2) + '%' : '—',   sub: 'at operating point' },
    { label: 'AUC',                  value: af.auc != null ? af.auc.toFixed(4) : '—',                 sub: 'Area under ROC curve' },
    { label: 'TAR @ FAR 1%',         value: af.tar_at_far?.['1e-2'] != null ? (af.tar_at_far['1e-2'] * 100).toFixed(1) + '%' : '—', sub: 'Genuine accepted when FAR≤1%' },
    { label: 'VLM cost / call',      value: vlm?.cost?.usd_per_decision != null ? '$' + vlm.cost.usd_per_decision.toFixed(4) : '—', sub: 'cli transport (Claude Code)' },
  ];

  root.innerHTML = `
    <!-- KPI strip -->
    <div class="grid-4" style="margin-bottom:var(--space-6);">
      ${kpis.map(k => `
        <div class="metric-card">
          <div class="metric-label">${k.label}</div>
          <div class="metric-value">${k.value}</div>
          <div class="metric-sub">${k.sub}</div>
        </div>
      `).join('')}
    </div>

    <!-- Findings tabs -->
    <div class="tabs" id="findings-tabs">
      <button class="tab-btn active" data-tab="roc">ROC / DET</button>
      <button class="tab-btn" data-tab="threshold">Threshold trade-off</button>
      <button class="tab-btn" data-tab="bias">Bias by group</button>
      <button class="tab-btn" data-tab="vlm">VLM calibration</button>
      <button class="tab-btn" data-tab="cost">Cost &amp; latency</button>
      <button class="tab-btn" data-tab="disagreement">Disagreement</button>
      <button class="tab-btn" data-tab="pad">PAD results</button>
    </div>

    <!-- ROC / DET -->
    <div class="tab-panel active" id="tab-roc">
      <div class="grid-2">
        <div class="card">
          <h4 style="margin-top:0;">ROC Curve — ArcFace vs InsightFace</h4>
          <p style="font-size:var(--text-sm);color:var(--text-2);margin-bottom:var(--space-3);">
            Model-vs-model ROC comparison. ArcFace (direct recognition) vs InsightFace (detection+alignment pipeline),
            both using the same buffalo_l backbone. ArcFace AUC = ${af.auc?.toFixed(4) ?? '—'}.
            ${insightface ? `InsightFace AUC = ${insightface.overall?.auc?.toFixed(4) ?? '—'}.` : ''}
          </p>
          <div class="chart-wrap"><canvas id="roc-canvas"></canvas></div>
        </div>
        <div class="card">
          <h4 style="margin-top:0;">DET Curve — ArcFace</h4>
          <p style="font-size:var(--text-sm);color:var(--text-2);margin-bottom:var(--space-3);">
            The DET (Detection Error Tradeoff) plots FRR vs FAR — both errors — on a log scale.
            The Equal Error Rate (EER = ${af.eer != null ? (af.eer * 100).toFixed(2) + '%' : '—'}) is where FAR = FRR.
          </p>
          <div class="chart-wrap"><canvas id="det-canvas"></canvas></div>
        </div>
      </div>
      <div class="callout callout-info" style="margin-top:var(--space-4);">
        <strong>What these show:</strong> AUC near 1.0 means the matcher strongly separates genuine from impostor at all thresholds — it is not luck of a single operating point. The DET curve lets you see where the error budget is; for financial step-up auth, regulators typically care about FAR (fraud risk) more than FRR (friction).
        ArcFace and InsightFace use the same w600k_r50 backbone: highly correlated scores, marginally different ROCs due to different preprocessing paths (direct recognition vs detection+alignment). That correlation itself is a finding.
      </div>
    </div>

    <!-- Threshold trade-off -->
    <div class="tab-panel" id="tab-threshold">
      <div class="card">
        <h4 style="margin-top:0;">FAR and FRR vs Threshold — ArcFace</h4>
        <p style="font-size:var(--text-sm);color:var(--text-2);margin-bottom:var(--space-3);">
          As the threshold rises, fewer pairs are accepted: FAR falls (fewer impostors accepted) but FRR rises (more genuines rejected).
          The operating point (threshold = ${thr.toFixed(3)}) was tuned to FAR ≈ 1%.
        </p>
        <div class="chart-wrap" style="height:320px;"><canvas id="thr-canvas"></canvas></div>
      </div>
      <div class="callout callout-info" style="margin-top:var(--space-4);">
        <strong>The uncertain band</strong> (${(thr - 0.07).toFixed(3)}–${(thr + 0.07).toFixed(3)}) straddles the operating threshold.
        Pairs in this region are the cases where the genuine and impostor distributions overlap — where a VLM second opinion has the most information value.
      </div>
    </div>

    <!-- Bias by group -->
    <div class="tab-panel" id="tab-bias">
      <div class="card">
        <h4 style="margin-top:0;">FAR and FRR by Demographic Group — ArcFace</h4>
        <div class="callout callout-warn" style="margin-bottom:var(--space-4);">
          <strong>Caveat:</strong> This corpus is 87% male (8,470 Male vs 1,280 Female pairs). Results for Female pairs are based on a small sample;
          confidence intervals are wide. FairFace labels applied to synthetic DigiFace faces introduce labelling uncertainty.
          Trends, not tight CIs.
        </div>
        <div class="chart-wrap" style="height:300px;"><canvas id="bias-canvas"></canvas></div>
      </div>
      <div class="callout callout-info" style="margin-top:var(--space-4);">
        <strong>What this shows:</strong> Aggregate accuracy can mask groups experiencing far higher error rates. A matcher that rejects female users at 3× the rate of male users is not acceptable even if overall FRR is low. The v1.5 re-run with a balanced corpus will give a more trustworthy disparity estimate.
      </div>
    </div>

    <!-- VLM calibration -->
    <div class="tab-panel" id="tab-vlm">
      <div class="card">
        <h4 style="margin-top:0;">VLM Confidence Calibration (Claude — cli mode)</h4>
        <p style="font-size:var(--text-sm);color:var(--text-2);margin-bottom:var(--space-3);">
          Calibration asks: when the VLM says "I'm 80% confident this is a match," is it right 80% of the time?
          A perfectly calibrated model's confidence = accuracy. ECE = ${vlm?.calibration?.ece != null ? vlm.calibration.ece.toFixed(4) : '—'} (expected calibration error; lower is better).
        </p>
        ${vlm?.calibration ? `
        <div class="chart-wrap"><canvas id="calib-canvas"></canvas></div>
        ` : `<div class="awaiting">VLM calibration data not available</div>`}
      </div>
      <div class="callout callout-warn" style="margin-top:var(--space-4);">
        <strong>VLM confidence ≠ VLM accuracy.</strong> A model that always outputs 0.85 confidence will look overconfident if accuracy is 0.70.
        ECE measures this gap. Until ECE is measured on the overlap zone (v1.5 re-run), reported VLM confidence numbers should not be treated as calibrated probabilities.
      </div>
    </div>

    <!-- Cost & latency -->
    <div class="tab-panel" id="tab-cost">
      <div class="grid-2">
        <div class="card">
          <h4 style="margin-top:0;">Cost — ArcFace vs VLM</h4>
          <p style="font-size:var(--text-sm);color:var(--text-2);margin-bottom:var(--space-4);">
            Cost per decision is the primary gating factor for VLM deployment. ArcFace is an embedded model — essentially free per call.
          </p>
          <div class="grid-2" style="gap:var(--space-3);">
            <div class="metric-card">
              <div class="metric-label">ArcFace cost/call</div>
              <div class="metric-value">$0.00</div>
              <div class="metric-sub">Embedded inference, no API</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">VLM cost/call</div>
              <div class="metric-value" style="color:var(--reject);">$${vlm?.cost?.usd_per_decision?.toFixed(4) ?? '—'}</div>
              <div class="metric-sub">cli transport (Claude Code headless)</div>
            </div>
            <div class="metric-card" style="grid-column:1/-1;">
              <div class="metric-label">VLM total (${vlm?.cost?.calls ?? 0} calls)</div>
              <div class="metric-value">$${vlm?.cost?.usd_total?.toFixed(2) ?? '—'}</div>
              <div class="metric-sub">240-pair VLM subset at ~$0.05/call</div>
            </div>
          </div>
          <div class="callout callout-info" style="margin-top:var(--space-4);">
            <strong>Token economy implication:</strong> at $0.05/call the VLM is viable only for uncertain-band cases (the ~15% of pairs near the threshold). Applying it universally would cost ~$500 per 10,000 auth attempts.
          </div>
        </div>
        <div class="card">
          <h4 style="margin-top:0;">Latency — ArcFace vs VLM</h4>
          <p style="font-size:var(--text-sm);color:var(--text-2);margin-bottom:var(--space-4);">
            ArcFace latency is effectively zero (embedding cache + cosine). VLM latency is dominated by generation time on the cli transport.
          </p>
          <div class="grid-2" style="gap:var(--space-3);">
            <div class="metric-card">
              <div class="metric-label">ArcFace p50</div>
              <div class="metric-value">≈ 0 ms</div>
              <div class="metric-sub">Cached embeddings + cosine</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">VLM p50</div>
              <div class="metric-value" style="color:var(--reject);">${vlm?.latency_ms?.p50 != null ? (vlm.latency_ms.p50 / 1000).toFixed(1) + ' s' : '—'}</div>
              <div class="metric-sub">cli transport (includes spawn overhead)</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">VLM p95</div>
              <div class="metric-value" style="color:var(--reject);">${vlm?.latency_ms?.p95 != null ? (vlm.latency_ms.p95 / 1000).toFixed(1) + ' s' : '—'}</div>
              <div class="metric-sub">95th percentile</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">ArcFace p95</div>
              <div class="metric-value">≈ 0 ms</div>
              <div class="metric-sub">No network call</div>
            </div>
          </div>
          <div class="callout callout-warn" style="margin-top:var(--space-4);">
            <strong>Production note:</strong> cli transport latency includes process spawn overhead (~3s). api transport (Anthropic key) would reduce this to ~6–8s. Either way, the VLM is asynchronous infrastructure — not in the real-time auth critical path.
          </div>
        </div>
      </div>
    </div>

    <!-- PAD Results (v2) -->
    <div class="tab-panel" id="tab-pad">
      ${padBaseline || padVlm ? `
      <div class="grid-2" style="margin-bottom:var(--space-5);">
        ${padBaseline ? `
        <div class="card">
          <h4 style="margin-top:0;">pad_baseline — frequency/texture detector</h4>
          <div class="grid-2" style="gap:var(--space-3);margin-bottom:var(--space-4);">
            <div class="metric-card">
              <div class="metric-label">APCER (attacks accepted as live)</div>
              <div class="metric-value" style="color:var(--reject);">${padBaseline.pad?.apcer != null ? (padBaseline.pad.apcer * 100).toFixed(1) + '%' : '—'}</div>
              <div class="metric-sub">Security failure rate</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">BPCER (bonafide rejected)</div>
              <div class="metric-value" style="color:var(--uncertain);">${padBaseline.pad?.bpcer != null ? (padBaseline.pad.bpcer * 100).toFixed(1) + '%' : '—'}</div>
              <div class="metric-sub">Friction on genuine users</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">ACER (average error)</div>
              <div class="metric-value">${padBaseline.pad?.acer != null ? (padBaseline.pad.acer * 100).toFixed(1) + '%' : '—'}</div>
              <div class="metric-sub">(APCER + BPCER) / 2</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">AUC / EER</div>
              <div class="metric-value">${padBaseline.overall?.auc?.toFixed(4) ?? '—'} / ${padBaseline.overall?.eer != null ? (padBaseline.overall.eer * 100).toFixed(1) + '%' : '—'}</div>
              <div class="metric-sub">PAD ROC area / equal error rate</div>
            </div>
          </div>
          <div class="chart-wrap" style="height:260px;"><canvas id="pad-roc-baseline-canvas"></canvas></div>
        </div>
        ` : ''}
        ${padVlm ? `
        <div class="card">
          <h4 style="margin-top:0;">pad_vlm — Claude passive-liveness prompt</h4>
          <div class="grid-2" style="gap:var(--space-3);margin-bottom:var(--space-4);">
            <div class="metric-card">
              <div class="metric-label">APCER</div>
              <div class="metric-value" style="color:var(--reject);">${padVlm.pad?.apcer != null ? (padVlm.pad.apcer * 100).toFixed(1) + '%' : '—'}</div>
              <div class="metric-sub">Attacks accepted as live</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">BPCER</div>
              <div class="metric-value" style="color:var(--uncertain);">${padVlm.pad?.bpcer != null ? (padVlm.pad.bpcer * 100).toFixed(1) + '%' : '—'}</div>
              <div class="metric-sub">Bonafide rejected</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">ECE (calibration)</div>
              <div class="metric-value">${padVlm.calibration?.ece?.toFixed(4) ?? '—'}</div>
              <div class="metric-sub">VLM PAD confidence calibration</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">Cost / call</div>
              <div class="metric-value">$${padVlm.cost?.usd_per_decision?.toFixed(4) ?? '—'}</div>
              <div class="metric-sub">${(padVlm.pad?.n_bonafide ?? 0) + (padVlm.pad?.n_attack ?? 0)} samples (VLM subset)</div>
            </div>
          </div>
          <div class="chart-wrap" style="height:260px;"><canvas id="pad-roc-vlm-canvas"></canvas></div>
        </div>
        ` : '<div class="card"><h4 style="margin-top:0;">pad_vlm</h4><div class="awaiting">Not yet run</div></div>'}
      </div>
      <div class="callout callout-warn">
        <strong>Simulated attacks only.</strong> Print and screen attacks are OpenCV/PIL degradations of synthetic
        DigiFace-1M images — not real physical presentation attacks. These results exercise metric infrastructure,
        not real-world PAD performance. iBeta Level 1 certification requires a standardised attack battery
        against a live biometric capture system (APCER ≤ 5%, BPCER ≤ 5%).
      </div>
      ` : `
      <div class="callout callout-info">
        <strong>PAD results not yet available.</strong>
        Run <code>python corpus/attacks.py</code> then <code>python eval/run_eval.py</code>,
        then <code>python portal/scripts/generate_data.py</code>.
      </div>
      `}
    </div>

    <!-- Disagreement -->
    <div class="tab-panel" id="tab-disagreement">
      <div class="card">
        <h4 style="margin-top:0;">Uncertain-band disagreement — ArcFace vs VLM</h4>
        <p style="font-size:var(--text-sm);color:var(--text-2);margin-bottom:var(--space-4);">
          The uncertain band is defined as ArcFace operating threshold ± 0.07 (${(thr - 0.07).toFixed(3)}–${(thr + 0.07).toFixed(3)}).
          Pairs in this band are where the genuine and impostor score distributions overlap — the cases where a VLM second opinion has information value.
        </p>

        <div class="grid-2" style="margin-bottom:var(--space-4);">
          <div class="metric-card">
            <div class="metric-label">Pairs in uncertain band</div>
            <div class="metric-value">${dis?.n_in_band ?? '—'}</div>
            <div class="metric-sub">Band: ${dis?.uncertain_band?.map(v => v.toFixed(3)).join('–') ?? '—'}</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">VLM correct in band</div>
            <div class="metric-value" style="color:var(--accept);">${dis?.vlm_correct_in_band ?? '—'} / ${dis?.n_in_band ?? '—'}</div>
            <div class="metric-sub">Decisions where ArcFace score was ambiguous</div>
          </div>
        </div>

        <div class="callout callout-info">
          <strong>What this means:</strong> ${dis?.n_in_band ?? 0} pairs fell in the overlap zone where ArcFace alone is uncertain.
          The VLM got ${dis?.vlm_correct_in_band ?? 0} of those right.
          With only ${dis?.n_in_band ?? 0} pairs in band, this is a directional signal — not a statistically tight estimate.
          The VLM subset was not oversampled toward the overlap zone in v2, so the band may contain few impostors.
          A targeted re-run that oversamples uncertain-band pairs would give a tighter read on whether the VLM second opinion earns its ~$0.05/call cost.
        </div>

        ${dis?.examples?.length ? `
        <h5 style="margin-top:var(--space-5);margin-bottom:var(--space-3);">Example uncertain-band pairs</h5>
        <table style="width:100%;border-collapse:collapse;font-size:var(--text-sm);">
          <thead>
            <tr>
              <th style="text-align:left;padding:6px 10px;color:var(--text-2);font-weight:500;border-bottom:1px solid var(--border);">Pair ID</th>
              <th style="text-align:left;padding:6px 10px;color:var(--text-2);font-weight:500;border-bottom:1px solid var(--border);">ArcFace score</th>
              <th style="text-align:left;padding:6px 10px;color:var(--text-2);font-weight:500;border-bottom:1px solid var(--border);">True label</th>
              <th style="text-align:left;padding:6px 10px;color:var(--text-2);font-weight:500;border-bottom:1px solid var(--border);">VLM decision</th>
            </tr>
          </thead>
          <tbody>
            ${dis.examples.map(e => `
            <tr>
              <td style="padding:6px 10px;border-bottom:1px solid var(--border);font-family:monospace;font-size:11px;">${e.pair_id}</td>
              <td style="padding:6px 10px;border-bottom:1px solid var(--border);">${e.arcface_score.toFixed(4)}</td>
              <td style="padding:6px 10px;border-bottom:1px solid var(--border);">${e.label}</td>
              <td style="padding:6px 10px;border-bottom:1px solid var(--border);">${e.vlm_decision ? 'match' : 'no match'}</td>
            </tr>
            `).join('')}
          </tbody>
        </table>
        ` : ''}
      </div>
    </div>
  `;

  // Wire tabs
  document.querySelectorAll('#findings-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#findings-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      // lazy-render charts when tab first becomes visible
      renderFindingsTab(btn.dataset.tab, arcface, vlm, thr);
    });
  });

  // render initial tab
  renderFindingsTab('roc', arcface, vlm, thr);
}

function renderFindingsTab(tab, arcface, vlm, thr) {
  if (tab === 'roc')         renderROC(arcface, _insightface);
  if (tab === 'threshold')   renderThresholdChart(arcface, thr);
  if (tab === 'bias')        renderBiasChart(arcface);
  if (tab === 'vlm')         renderCalibration(vlm);
  if (tab === 'pad')         renderPADTab(_padBaseline, _padVlm);
}

function renderROC(arcface, insightface) {
  if (!arcface?.roc?.length) return;

  // ROC: TAR vs FAR — ArcFace + optional InsightFace overlay
  {
    const id = 'roc-canvas';
    destroyChart(id);
    const roc = arcface.roc.sort((a, b) => a.far - b.far);
    const ctx = document.getElementById(id)?.getContext('2d');
    if (!ctx) return;

    const datasets = [
      {
        label: `ArcFace (AUC ${arcface.overall?.auc?.toFixed(4) ?? '—'})`,
        data: roc.map(r => ({ x: +(r.far * 100).toFixed(4), y: +(r.tar * 100).toFixed(4) })),
        borderColor: fpal().primary,
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
      },
    ];

    if (insightface?.roc?.length) {
      const ifRoc = [...insightface.roc].sort((a, b) => a.far - b.far);
      datasets.push({
        label: `InsightFace (AUC ${insightface.overall?.auc?.toFixed(4) ?? '—'})`,
        data: ifRoc.map(r => ({ x: +(r.far * 100).toFixed(4), y: +(r.tar * 100).toFixed(4) })),
        borderColor: fpal().accept,
        borderWidth: 2,
        borderDash: [6, 3],
        pointRadius: 0,
        fill: false,
      });
    }

    datasets.push({
      label: 'Random',
      data: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
      borderColor: fpal().text,
      borderWidth: 1,
      borderDash: [4, 4],
      pointRadius: 0,
      fill: false,
    });

    findingsCharts[id] = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: fpal().text, font: { size: 12 } } } },
        scales: {
          x: { type: 'linear', min: 0, max: 100, ticks: { color: fpal().text }, grid: { color: fpal().grid }, title: { display: true, text: 'FAR (%)', color: fpal().text } },
          y: { min: 0, max: 100, ticks: { color: fpal().text }, grid: { color: fpal().grid }, title: { display: true, text: 'TAR (%)', color: fpal().text } },
        },
      },
    });
  }

  // DET: FRR vs FAR (log scale approximation — use linear with small values)
  {
    const id = 'det-canvas';
    destroyChart(id);
    const roc = arcface.roc.sort((a, b) => a.far - b.far);
    const ctx = document.getElementById(id)?.getContext('2d');
    if (!ctx) return;
    findingsCharts[id] = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [{
          label: 'ArcFace DET',
          data: roc.map(r => ({ x: +((r.far * 100).toFixed(4)), y: +((r.frr * 100).toFixed(4)) })),
          borderColor: fpal().reject,
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: fpal().text, font: { size: 12 } } } },
        scales: {
          x: { type: 'logarithmic', min: 0.01, ticks: { color: fpal().text }, grid: { color: fpal().grid }, title: { display: true, text: 'FAR (%)', color: fpal().text } },
          y: { type: 'logarithmic', min: 0.01, ticks: { color: fpal().text }, grid: { color: fpal().grid }, title: { display: true, text: 'FRR (%)', color: fpal().text } },
        },
      },
    });
  }
}

function renderThresholdChart(arcface, opThr) {
  const id = 'thr-canvas';
  destroyChart(id);
  if (!arcface?.roc?.length) return;
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return;

  const roc = [...arcface.roc].sort((a, b) => a.threshold - b.threshold);

  findingsCharts[id] = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'FAR',
          data: roc.map(r => ({ x: +r.threshold.toFixed(4), y: +(r.far * 100).toFixed(4) })),
          borderColor: fpal().reject,
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          yAxisID: 'y',
        },
        {
          label: 'FRR',
          data: roc.map(r => ({ x: +r.threshold.toFixed(4), y: +(r.frr * 100).toFixed(4) })),
          borderColor: fpal().uncertain,
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          yAxisID: 'y',
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: fpal().text, font: { size: 12 } } },
        annotation: undefined,
      },
      scales: {
        x: {
          type: 'linear',
          ticks: { color: fpal().text, maxTicksLimit: 10 },
          grid: { color: fpal().grid },
          title: { display: true, text: 'Threshold', color: fpal().text },
        },
        y: {
          ticks: { color: fpal().text },
          grid: { color: fpal().grid },
          title: { display: true, text: 'Error Rate (%)', color: fpal().text },
        },
      },
    },
    plugins: [{
      id: 'op-line',
      afterDraw(chart) {
        const { ctx: c, scales: { x, y } } = chart;
        const xPos = x.getPixelForValue(opThr);
        c.save();
        c.strokeStyle = fpal().primary;
        c.lineWidth = 2;
        c.setLineDash([4, 4]);
        c.beginPath();
        c.moveTo(xPos, y.top);
        c.lineTo(xPos, y.bottom);
        c.stroke();
        c.fillStyle = fpal().primary;
        c.font = '11px monospace';
        c.fillText(`thr=${opThr.toFixed(3)}`, xPos + 4, y.top + 14);
        c.restore();
      },
    }],
  });
}

function renderBiasChart(arcface) {
  const id = 'bias-canvas';
  destroyChart(id);
  const groups = arcface?.by_group;
  if (!groups?.length) return;
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return;

  const labels = groups.map(g => g.group);
  findingsCharts[id] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'FAR',
          data: groups.map(g => +(g.far * 100).toFixed(3)),
          backgroundColor: fpal().reject + 'BB',
          borderColor: fpal().reject,
          borderWidth: 1,
        },
        {
          label: 'FRR',
          data: groups.map(g => +(g.frr * 100).toFixed(3)),
          backgroundColor: fpal().uncertain + 'BB',
          borderColor: fpal().uncertain,
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: fpal().text, font: { size: 12 } } } },
      scales: {
        x: { ticks: { color: fpal().text }, grid: { color: fpal().grid } },
        y: {
          ticks: { color: fpal().text, callback: v => v + '%' },
          grid: { color: fpal().grid },
          title: { display: true, text: 'Error Rate (%)', color: fpal().text },
        },
      },
    },
  });
}

function renderCalibration(vlm) {
  const id = 'calib-canvas';
  destroyChart(id);
  const calib = vlm?.calibration;
  if (!calib?.bins?.length) return;
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return;

  const bins = calib.bins;
  findingsCharts[id] = new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'VLM (confidence vs accuracy)',
          data: bins.map(b => ({ x: +(b.conf * 100).toFixed(1), y: +(b.acc * 100).toFixed(1), n: b.n })),
          backgroundColor: fpal().primary + 'CC',
          pointRadius: bins.map(b => Math.min(20, Math.max(5, Math.sqrt(b.n) * 2))),
          pointHoverRadius: 12,
        },
        {
          label: 'Perfect calibration',
          data: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
          borderColor: fpal().text,
          borderWidth: 1,
          borderDash: [4, 4],
          pointRadius: 0,
          type: 'line',
          fill: false,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: fpal().text, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: ctx => `conf=${ctx.raw.x}% acc=${ctx.raw.y}% n=${ctx.raw.n ?? ''}`,
          },
        },
      },
      scales: {
        x: { min: 0, max: 100, ticks: { color: fpal().text, callback: v => v + '%' }, grid: { color: fpal().grid }, title: { display: true, text: 'VLM Confidence (%)', color: fpal().text } },
        y: { min: 0, max: 100, ticks: { color: fpal().text, callback: v => v + '%' }, grid: { color: fpal().grid }, title: { display: true, text: 'Accuracy (%)', color: fpal().text } },
      },
    },
  });
}

function renderPADTab(padBaseline, padVlm) {
  _renderPADROC('pad-roc-baseline-canvas', padBaseline, 'pad_baseline');
  _renderPADROC('pad-roc-vlm-canvas', padVlm, 'pad_vlm');
}

function _renderPADROC(id, matcher, label) {
  destroyChart(id);
  if (!matcher?.roc?.length) return;
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return;

  const roc = [...matcher.roc].sort((a, b) => a.far - b.far);
  findingsCharts[id] = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: `${label} (AUC ${matcher.overall?.auc?.toFixed(4) ?? '—'})`,
          data: roc.map(r => ({ x: +(r.far * 100).toFixed(4), y: +(r.tar * 100).toFixed(4) })),
          borderColor: fpal().primary,
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
        },
        {
          label: 'Random',
          data: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
          borderColor: fpal().text,
          borderWidth: 1,
          borderDash: [4, 4],
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: fpal().text, font: { size: 12 } } } },
      scales: {
        x: {
          type: 'linear', min: 0, max: 100,
          ticks: { color: fpal().text },
          grid: { color: fpal().grid },
          title: { display: true, text: 'APCER — attack accepted as live (%)', color: fpal().text },
        },
        y: {
          min: 0, max: 100,
          ticks: { color: fpal().text },
          grid: { color: fpal().grid },
          title: { display: true, text: 'Bonafide acceptance rate (%)', color: fpal().text },
        },
      },
    },
  });
}

// Re-render the active findings tab when theme changes
window.__findingsRerender = function() {
  if (!_arcface) return;
  const active = document.querySelector('#findings-tabs .tab-btn.active');
  if (active) renderFindingsTab(active.dataset.tab, _arcface, _vlm, _opThr);
};
