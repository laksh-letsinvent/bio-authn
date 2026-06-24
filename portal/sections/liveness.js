async function initLiveness() {
  const root = document.getElementById('liveness-content');

  let padMeta = [];
  let evalRun = null;
  try {
    padMeta = await fetch('data/pad_examples.json').then(r => r.json());
  } catch (e) {
    // non-fatal; render without images
  }
  try {
    evalRun = await fetch('data/eval_run.json').then(r => r.json());
  } catch (e) {
    // non-fatal; measured PAD section will show placeholder
  }

  const padBaseline = evalRun?.matchers?.find(m => m.matcher_id === 'pad_baseline');
  const padVlm      = evalRun?.matchers?.find(m => m.matcher_id === 'pad_vlm');

  // pick one subject for spot-the-attack; use first available
  const subject = padMeta[0] || null;

  root.innerHTML = `
    <!-- Spot-the-attack -->
    <div class="card" style="margin-bottom:var(--space-5);">
      <h2 style="margin-top:0;font-size:var(--text-2xl);">What is a presentation attack?</h2>
      <p style="margin-bottom:var(--space-4);">
        A <strong>presentation attack</strong> is an attempt to fool the biometric sensor with something other than a live face — a printed photo, a phone replaying a video, or a 3D mask.
        Face matching passes these unless a separate liveness check is applied.
      </p>
      <p style="margin-bottom:var(--space-5);">
        <strong>Try it:</strong> below are three captures of the same identity — one genuine live capture, one printed photo photographed, one phone-screen replay photographed. Can you tell them apart?
      </p>

      ${subject ? `
      <div class="attack-grid" id="attack-grid">
        <div class="attack-item" data-type="genuine" onclick="handleAttackGuess(this)">
          <div class="attack-img-wrap">
            <img src="${subject.genuine}" alt="Capture A">
          </div>
          <div class="attack-label">Capture A</div>
        </div>
        <div class="attack-item" data-type="print_attack" onclick="handleAttackGuess(this)">
          <div class="attack-img-wrap">
            <img src="${subject.print_attack}" alt="Capture B">
          </div>
          <div class="attack-label">Capture B</div>
        </div>
        <div class="attack-item" data-type="screen_attack" onclick="handleAttackGuess(this)">
          <div class="attack-img-wrap">
            <img src="${subject.screen_attack}" alt="Capture C">
          </div>
          <div class="attack-label">Capture C</div>
        </div>
      </div>

      <div id="attack-reveal" class="attack-reveal"></div>
      ` : `
      <div class="callout callout-info">
        <strong>Images not found.</strong> Run <code>python3 portal/scripts/generate_data.py</code> from the project root to generate <code>portal/data/pad_examples/</code>.
      </div>
      `}

      <div class="callout callout-info" style="margin-top:var(--space-5);">
        <strong>The tells to look for in a print attack:</strong>
        moiré patterns (repeating grid artifact from the lens photographing the printed dot matrix),
        flattened texture (no pore-level depth),
        warm yellow cast from photo paper,
        soft edges from scanning blur.
        Screen replays add: scan lines, bezel edges, blue-cool colour shift, specular glare patch.
      </div>
    </div>

    <!-- Metrics: APCER / BPCER -->
    <div class="card" style="margin-bottom:var(--space-5);">
      <h2 style="margin-top:0;font-size:var(--text-2xl);">The two PAD error rates</h2>
      <p style="margin-bottom:var(--space-4);">
        PAD introduces its own error trade-off, independent of FAR/FRR. The two rates come from ISO 30107-3.
      </p>
      <div class="grid-2" style="margin-bottom:var(--space-5);">
        <div class="metric-card" style="border:1px solid var(--border);">
          <div class="metric-label">APCER — Attack Presentation Classification Error Rate</div>
          <div class="metric-value" style="color:var(--reject);font-size:var(--text-xl);">Attacks → accepted as live</div>
          <div class="metric-sub" style="margin-top:var(--space-2);">
            Fraction of presentation attacks that the PAD system wrongly classifies as genuine live faces.
            Analogous to FAR, but for the liveness gate.
          </div>
        </div>
        <div class="metric-card" style="border:1px solid var(--border);">
          <div class="metric-label">BPCER — Bona Fide Presentation Classification Error Rate</div>
          <div class="metric-value" style="color:var(--uncertain);font-size:var(--text-xl);">Genuine → rejected as attack</div>
          <div class="metric-sub" style="margin-top:var(--space-2);">
            Fraction of genuine live presentations that the PAD system wrongly classifies as attacks.
            Analogous to FRR, but for the liveness gate.
          </div>
        </div>
      </div>
      <p style="color:var(--text-2);font-size:var(--text-sm);">
        APCER measures attacker success — you want this as close to 0 as possible. BPCER measures friction on real users — they trade off at the PAD decision threshold.
        iBeta Level 1 certification requires APCER ≤ 5% and BPCER ≤ 5% under a standardised attack battery.
      </p>
      <div class="callout callout-warn" style="margin-top:var(--space-4);">
        <strong>Important:</strong> APCER/BPCER are liveness metrics. FAR/FMR are matching metrics. Do not conflate them —
        a system can have near-zero FAR and still be trivially defeated by a printed photo if it lacks PAD.
      </div>
    </div>

    <!-- Liveness challenge animation -->
    <div class="card" style="margin-bottom:var(--space-5);">
      <h2 style="margin-top:0;font-size:var(--text-2xl);">Why a random active challenge defeats static attacks</h2>
      <p style="margin-bottom:var(--space-5);">
        A passive PAD analyses the texture of one frame. An active liveness challenge asks the person to perform an unpredictable action — defeating pre-recorded replays and printed photos because they cannot respond.
      </p>
      <div class="liveness-demo">
        <div class="liveness-icon" id="liveness-icon">😐</div>
        <div class="liveness-prompt" id="liveness-prompt">Starting…</div>
        <div class="liveness-sub" id="liveness-sub"></div>
      </div>
      <div style="margin-top:var(--space-4);display:flex;justify-content:center;">
        <button class="btn btn-primary" onclick="startLivenessDemo()">Replay demo</button>
      </div>
      <p style="color:var(--text-2);font-size:var(--text-sm);margin-top:var(--space-4);">
        A printed photo cannot blink. A looping screen video cannot follow a randomised blink + turn sequence. The key is that the challenge sequence is generated fresh and unpredictably — any pre-recorded clip is rendered useless.
      </p>
    </div>

    <!-- Attack taxonomy -->
    <div class="card" style="margin-bottom:var(--space-5);">
      <h2 style="margin-top:0;font-size:var(--text-2xl);">Attack taxonomy</h2>
      <p style="margin-bottom:var(--space-4);">
        Attacks are classified by what is presented to the sensor (ISO 30107-1).
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:var(--text-sm);">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px 12px;color:var(--text-2);font-weight:500;border-bottom:1px solid var(--border);">Attack type</th>
            <th style="text-align:left;padding:8px 12px;color:var(--text-2);font-weight:500;border-bottom:1px solid var(--border);">What is presented</th>
            <th style="text-align:left;padding:8px 12px;color:var(--text-2);font-weight:500;border-bottom:1px solid var(--border);">Key tell</th>
          </tr>
        </thead>
        <tbody>
          ${[
            ['Print attack',     'Photograph of target face, printed and held up',       'Moiré, flat texture, paper grain'],
            ['Screen replay',    'Screen displaying a video or photo of the target',     'Scan lines, bezel edges, screen glare, colour cast'],
            ['Rigid 3D mask',    "Hard mask of target's face (paper, resin)",             'No micro-movement, uniform depth, edge artifacts'],
            ['Flexible 3D mask', 'Silicone mask — most sophisticated',                   'Texture at edges, reduced micro-expression range'],
            ['Deepfake / avatar','Synthesised face video piped into the camera stream',  'Injection point is the video feed, not the sensor — capture integrity required'],
          ].map(([t, w, k]) => `
            <tr>
              <td style="padding:8px 12px;border-bottom:1px solid var(--border);font-weight:500;">${t}</td>
              <td style="padding:8px 12px;border-bottom:1px solid var(--border);color:var(--text-2);">${w}</td>
              <td style="padding:8px 12px;border-bottom:1px solid var(--border);color:var(--text-2);">${k}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="callout callout-info" style="margin-top:var(--space-5);">
        <strong>Deepfakes change the threat model.</strong> A PAD running on the sensor-side cannot detect a deepfake injected upstream. The defence is signed capture: the camera signs the raw frame so the server can verify it came from a real sensor and was not intercepted. This is why capture integrity is a separate defence layer from PAD.
      </div>
    </div>

    <!-- Measured PAD results (v2) -->
    <div class="card" style="margin-bottom:var(--space-5);">
      <h2 style="margin-top:0;font-size:var(--text-2xl);">Measured PAD results — v2</h2>
      <p style="margin-bottom:var(--space-4);">
        Results below are measured on <strong>simulated</strong> presentation attacks (OpenCV/PIL degradations of
        DigiFace-1M images). Not a real-world attack battery or iBeta-grade evaluation —
        the purpose is to exercise the PAD metric infrastructure and compare baseline vs VLM approaches.
      </p>
      ${padBaseline ? `
      <div class="grid-2" style="margin-bottom:var(--space-5);">
        <div class="metric-card" style="border:1px solid var(--border);">
          <div class="metric-label">pad_baseline — frequency/texture detector</div>
          <div class="metric-value" style="font-size:var(--text-lg);">
            APCER ${(padBaseline.pad?.apcer * 100).toFixed(1)}% &nbsp;|&nbsp;
            BPCER ${(padBaseline.pad?.bpcer * 100).toFixed(1)}% &nbsp;|&nbsp;
            ACER ${(padBaseline.pad?.acer * 100).toFixed(1)}%
          </div>
          <div class="metric-sub" style="margin-top:var(--space-2);">
            AUC ${padBaseline.overall?.auc?.toFixed(4) ?? '—'} · EER ${padBaseline.overall?.eer != null ? (padBaseline.overall.eer * 100).toFixed(2) + '%' : '—'} ·
            Free / deterministic (FFT + local variance)
          </div>
        </div>
        ${padVlm ? `
        <div class="metric-card" style="border:1px solid var(--border);">
          <div class="metric-label">pad_vlm — Claude passive-liveness prompt (${evalRun?.run?.vlm_mode ?? 'cli'} mode)</div>
          <div class="metric-value" style="font-size:var(--text-lg);">
            APCER ${(padVlm.pad?.apcer * 100).toFixed(1)}% &nbsp;|&nbsp;
            BPCER ${(padVlm.pad?.bpcer * 100).toFixed(1)}% &nbsp;|&nbsp;
            ACER ${(padVlm.pad?.acer * 100).toFixed(1)}%
          </div>
          <div class="metric-sub" style="margin-top:var(--space-2);">
            AUC ${padVlm.overall?.auc?.toFixed(4) ?? '—'} · ECE ${padVlm.calibration?.ece?.toFixed(4) ?? '—'} ·
            $${padVlm.cost?.usd_per_decision?.toFixed(4) ?? '—'}/call
          </div>
        </div>
        ` : '<div class="metric-card" style="border:1px solid var(--border);"><div class="metric-label">pad_vlm</div><div class="awaiting">Not yet run</div></div>'}
      </div>
      <div class="callout callout-warn">
        <strong>Simulated attacks:</strong> these results use OpenCV-generated print and screen
        degradations — not real physical presentation attacks. APCER/BPCER numbers will differ
        substantially on real-world attacks. This exercises the measurement framework; iBeta Level 1
        requires a standardised attack battery against a physical biometric system.
      </div>
      ` : `
      <div class="callout callout-info">
        <strong>Measured PAD results not yet available.</strong>
        Run: <code>python corpus/attacks.py</code> then <code>python eval/run_eval.py</code>,
        then <code>python portal/scripts/generate_data.py</code>.
      </div>
      `}
    </div>

    <div class="attribution">
      Corpus: <a href="https://github.com/microsoft/DigiFace1M" target="_blank" rel="noopener">DigiFace-1M</a>
      (Microsoft) — synthetic faces, non-commercial research use (R-UDA).
      Attack images are generated by applying synthetic degradation transforms to corpus images.
    </div>
  `;

  // start animation on init
  startLivenessDemo();
}

function handleAttackGuess(el) {
  document.querySelectorAll('.attack-item').forEach(i => i.classList.remove('selected'));
  el.classList.add('selected');

  const type = el.dataset.type;
  const reveal = document.getElementById('attack-reveal');
  reveal.className = 'attack-reveal visible';

  if (type === 'genuine') {
    reveal.className += ' attack-reveal-genuine';
    reveal.innerHTML = `
      <strong>Correct — this is the genuine live capture.</strong>
      Skin texture is natural: pores visible, micro-shadows present, consistent depth. No moiré, no scan lines, no bezel.
    `;
  } else if (type === 'print_attack') {
    reveal.className += ' attack-reveal-attack';
    reveal.innerHTML = `
      <strong>This is a print attack</strong> — a photograph of a photograph. Look for:
      warm yellow cast from paper/toner, moiré patterns in smooth skin areas,
      loss of high-frequency texture (pores flattened), slight blur from the second-lens scan.
    `;
  } else {
    reveal.className += ' attack-reveal-attack';
    reveal.innerHTML = `
      <strong>This is a screen replay attack</strong> — a live capture of a screen showing a photo.
      Look for: blue-cool colour cast from LED backlight, horizontal scan lines every few pixels,
      specular glare patch (top-right), slight brightness banding across the screen surface.
    `;
  }
}

const LIVENESS_STEPS = [
  { icon: '😐', prompt: 'Look straight at the camera', sub: 'Establishing baseline', duration: 1800 },
  { icon: '😉', prompt: 'Blink twice', sub: 'A printed photo cannot blink', duration: 2000 },
  { icon: '↩️', prompt: 'Turn your head left', sub: 'A looping video cannot respond to a new prompt', duration: 1800 },
  { icon: '↪️', prompt: 'Turn your head right', sub: 'The sequence is randomised each session', duration: 1800 },
  { icon: '😐', prompt: 'Look straight again', sub: 'Verifying return', duration: 1500 },
  { icon: '✅', prompt: 'Liveness confirmed', sub: 'Challenge sequence complete — this was a live person', duration: 2500 },
];

let livenessTimer = null;

function startLivenessDemo() {
  if (livenessTimer) clearTimeout(livenessTimer);
  let step = 0;

  function runStep() {
    if (step >= LIVENESS_STEPS.length) return;
    const s = LIVENESS_STEPS[step];
    const icon = document.getElementById('liveness-icon');
    const prompt = document.getElementById('liveness-prompt');
    const sub = document.getElementById('liveness-sub');
    if (!icon) return;
    icon.textContent = s.icon;
    prompt.textContent = s.prompt;
    sub.textContent = s.sub;
    step++;
    livenessTimer = setTimeout(runStep, s.duration);
  }
  runStep();
}
