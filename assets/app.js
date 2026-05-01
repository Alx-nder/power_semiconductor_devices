let data = window.DEVICE_DATA || null;
let forwardChart = null;
let reverseChart = null;
let transientChart = null;
let procTempChart = null;
let procTimeChart = null;
const DISPLAY_REVERSE_PLOTS = false;

const state = {
  mode: 'steady',
  family: 'pin',
  voltage: '600V',
  materials: { 'Si': true, '4H-SiC': true, 'GaN': true },
  logY: false
};

function byId(id) {
  return document.getElementById(id);
}

function show(node, isVisible) {
  node.hidden = !isVisible;
}

function setLogY(isLog) {
  state.logY = isLog;
  byId('btn-log').classList.toggle('active', isLog);
  byId('btn-lin').classList.toggle('active', !isLog);
  renderPlots();
}

function btn(text, active, click) {
  const b = document.createElement('button');
  b.textContent = text;
  if (active) b.classList.add('active');
  b.addEventListener('click', click);
  return b;
}

function destroyCharts() {
  if (forwardChart) { forwardChart.destroy(); forwardChart = null; }
  if (reverseChart) { reverseChart.destroy(); reverseChart = null; }
  if (transientChart) { transientChart.destroy(); transientChart = null; }
}

function buildModeRow() {
  const row = document.getElementById('mode-row');
  row.querySelectorAll('button').forEach(n => n.remove());
  ['steady', 'dpt', 'process'].forEach(mode => {
    const label = mode === 'steady' ? 'Steady I-V' : mode === 'dpt' ? 'Double Pulse Test' : 'Process Manuf.';
    const b = btn(label, state.mode === mode, () => {
      state.mode = mode;
      buildModeRow();
      renderAll();
    });
    row.appendChild(b);
  });
}

function buildFamilyRow() {
  const row = document.getElementById('family-row');
  row.querySelectorAll('button').forEach(n => n.remove());
  Object.entries(data.meta.families).forEach(([key, label]) => {
    row.appendChild(btn(label, state.family === key, () => {
      state.family = key;
      buildFamilyRow();
      buildVoltageRow();
      renderAll();
    }));
  });
}

function buildVoltageRow() {
  const row = document.getElementById('voltage-row');
  row.querySelectorAll('button').forEach(n => n.remove());
  const modeKey = state.mode === 'dpt' ? 'transient' : state.mode;
  const classes = Object.keys(data[modeKey][state.family].classes);
  if (!classes.includes(state.voltage)) {
    state.voltage = classes[0];
  }
  syncCalcBVToSelection();
  classes.forEach(v => {
    row.appendChild(btn(v, state.voltage === v, () => {
      state.voltage = v;
      syncCalcBVToSelection();
      buildVoltageRow();
      renderAll();
    }));
  });
}

function buildMaterialRow() {
  const row = document.getElementById('material-row');
  row.querySelectorAll('.material-chip').forEach(n => n.remove());

  const colorMap = data.meta.colors;
  const modeKey = state.mode === 'dpt' ? 'transient' : state.mode;
  const classNode = data[modeKey]?.[state.family]?.classes?.[state.voltage];

  function hasData(mat) {
    if (!classNode?.materials?.[mat]) return false;
    const m = classNode.materials[mat];
    if (modeKey === 'steady') {
      return (m.forward?.voltage?.length > 0) || (m.forward_family?.some(curve => curve.voltage?.length) ?? false);
    }
    return (m.trace?.time?.length > 0) || (m.trace?.x?.length > 0);
  }
  
  // Order: GaAs, Si, SiC, GaN, Diamond
  const orderedMaterials = [
    { mat: 'GaAs', alwaysUnavailable: true, color: '#b8a892' },
    { mat: 'Si', alwaysUnavailable: false },
    { mat: '4H-SiC', alwaysUnavailable: false },
    { mat: 'GaN', alwaysUnavailable: false },
    { mat: 'Diamond', alwaysUnavailable: true, color: '#8a97a6' }
  ];
  
  orderedMaterials.forEach(item => {
    const available = !item.alwaysUnavailable && hasData(item.mat);
    if (available) {
      // Available material
      const mat = item.mat;
      const key = Object.entries(data.meta.materials).find(([, v]) => v === mat)?.[0] || mat.toLowerCase();
      const chip = document.createElement('label');
      chip.className = 'chip material-chip' + (state.materials[mat] ? '' : ' inactive');

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = state.materials[mat];
      input.addEventListener('change', () => {
        state.materials[mat] = input.checked;
        buildMaterialRow();
        renderPlots();
      });

      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = colorMap[key] || '#666';

      const txt = document.createElement('span');
      txt.textContent = mat;

      chip.appendChild(input);
      chip.appendChild(dot);
      chip.appendChild(txt);
      row.appendChild(chip);
    } else {
      // Unavailable material
      const chip = document.createElement('span');
      chip.className = 'chip material-chip unavailable';
      chip.title = item.alwaysUnavailable ? 'Not yet available' : 'No simulation data for this combination';
      chip.setAttribute('aria-disabled', 'true');

      const dot = document.createElement('span');
      dot.className = 'dot';
      const uKey = Object.entries(data.meta.materials).find(([, v]) => v === item.mat)?.[0] || item.mat.toLowerCase();
      dot.style.background = item.color || colorMap[uKey] || '#999';

      const txt = document.createElement('span');
      txt.className = 'chip-label';
      txt.textContent = item.mat;

      chip.appendChild(dot);
      chip.appendChild(txt);
      row.appendChild(chip);
    }
  });
}

function withAlpha(color, alpha) {
  if (!color || color[0] !== '#' || (color.length !== 7 && color.length !== 4)) return color;
  let r, g, b;
  if (color.length === 7) {
    r = parseInt(color.slice(1, 3), 16);
    g = parseInt(color.slice(3, 5), 16);
    b = parseInt(color.slice(5, 7), 16);
  } else {
    r = parseInt(color[1] + color[1], 16);
    g = parseInt(color[2] + color[2], 16);
    b = parseInt(color[3] + color[3], 16);
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function seriesDataset(name, color, x, y, options = {}) {
  const pts = x.map((vx, i) => ({ x: vx, y: y[i] }));
  return {
    label: name,
    data: pts,
    borderColor: options.borderColor || color,
    backgroundColor: options.backgroundColor || color,
    borderWidth: options.borderWidth || 2,
    borderDash: options.borderDash || [],
    pointRadius: options.pointRadius ?? 0,
    showLine: true,
    tension: 0
  };
}

function chartOptions(xLabel, yLabel, logY = false, yMax = null, yMin = null) {
  const yAxis = {
    type: logY ? 'logarithmic' : 'linear',
    title: { display: true, text: yLabel },
    grid: { color: 'rgba(0,0,0,0.08)' }
  };
  if (logY) {
    yAxis.ticks = {
      callback: (v) => v === 0 ? '0' : v.toExponential(0)
    };
  }
  if (yMax !== null) yAxis.max = yMax;
  if (yMin !== null) yAxis.min = yMin;
  return {
    responsive: true,
    animation: false,
    plugins: {
      legend: { position: 'top' }
    },
    scales: {
      x: {
        type: 'linear',
        title: { display: true, text: xLabel },
        grid: { color: 'rgba(0,0,0,0.08)' }
      },
      y: yAxis
    }
  };
}

function dptChartOptions() {
  return {
    responsive: true,
    animation: false,
    interaction: { mode: 'nearest', intersect: false },
    plugins: { legend: { position: 'top' } },
    scales: {
      x: {
        type: 'linear',
        title: { display: true, text: 'Time (s)' },
        grid: { color: 'rgba(0,0,0,0.08)' }
      },
      y: {
        type: 'linear',
        position: 'left',
        title: { display: true, text: 'DUT Current (A)' },
        grid: { color: 'rgba(0,0,0,0.08)' }
      },
      y1: {
        type: 'linear',
        position: 'right',
        title: { display: true, text: 'DUT Voltage (V)' },
        grid: { drawOnChartArea: false }
      }
    }
  };
}

function fmtMetric(value, unit) {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  let text;
  if (abs !== 0 && (abs < 0.01 || abs >= 10000)) text = value.toExponential(2);
  else if (abs >= 100) text = value.toFixed(1);
  else if (abs >= 10) text = value.toFixed(2);
  else text = value.toFixed(3);
  return unit ? `${text} ${unit}` : text;
}

function renderSteady(entry) {
  const fwdSets = [];
  const mosfetDashPatterns = [[], [8, 3], [4, 2], [2, 2], [10, 2, 2, 2]];

  Object.entries(entry.materials).forEach(([mat, d]) => {
    if (!state.materials[mat]) return;
    const color = d.color || '#666';
    if (state.family === 'mosfet' && Array.isArray(d.forward_family) && d.forward_family.length) {
      d.forward_family.forEach((curve, idx) => {
        if (!curve.voltage?.length) return;
        const yAbs = curve.current.map(v => Math.abs(v));
        const gateLabel = Number.isFinite(curve.gate_voltage) ? curve.gate_voltage : curve.label;
        fwdSets.push(seriesDataset(
          `${mat} | Vg=${gateLabel} V`,
          color,
          curve.voltage,
          yAbs,
          {
            borderColor: withAlpha(color, Math.max(0.4, 1 - idx * 0.12)),
            backgroundColor: withAlpha(color, Math.max(0.4, 1 - idx * 0.12)),
            borderDash: mosfetDashPatterns[idx % mosfetDashPatterns.length]
          }
        ));
      });
    } else if (d.forward && d.forward.voltage?.length) {
      const yAbs = d.forward.current.map(v => Math.abs(v));
      fwdSets.push(seriesDataset(mat, color, d.forward.voltage, yAbs));
    }
  });

  show(byId('forward-none'), !fwdSets.length);

  if (fwdSets.length) {
    const fwdYMax = state.family === 'mosfet' ? null : 100;
    const steadyYLabel = state.family === 'mosfet' ? '|I_D| (A)' : '|J| (A/cm²)';
    forwardChart = new Chart(document.getElementById('forward-chart'), {
      type: 'scatter',
      data: { datasets: fwdSets },
      options: chartOptions('Voltage (V)', steadyYLabel, state.logY, fwdYMax, state.logY ? 1e-10 : null)
    });
  }
}

function renderTransient(entry) {
  const sets = [];

  Object.entries(entry.materials).forEach(([mat, d]) => {
    if (!state.materials[mat]) return;
    if (!d.trace) return;
    const time = d.trace.time || d.trace.x;
    const current = d.trace.current || d.trace.y;
    if (!time?.length || !current?.length) return;
    const color = d.color || '#666';
    sets.push(seriesDataset(`${mat} | I_DUT`, color, time, current));
    if (state.mode === 'dpt' && d.trace.voltage?.length) {
      sets.push({
        ...seriesDataset(`${mat} | V_DUT`, color, time, d.trace.voltage, {
          borderColor: withAlpha(color, 0.55),
          backgroundColor: withAlpha(color, 0.55),
          borderDash: [7, 3]
        }),
        yAxisID: 'y1'
      });
    }
  });

  show(byId('transient-none'), !sets.length);

  if (sets.length) {
    transientChart = new Chart(document.getElementById('transient-chart'), {
      type: 'scatter',
      data: { datasets: sets },
      options: state.mode === 'dpt' ? dptChartOptions() : chartOptions('Time (s)', 'DUT Current (A)', false)
    });
  }
}

function renderDptMetrics(entry) {
  const grid = document.getElementById('dpt-metrics');
  grid.innerHTML = '';
  const summaries = [];
  Object.entries(entry.materials).forEach(([mat, d]) => {
    if (!state.materials[mat] || !d.dpt_summary) return;
    summaries.push({ mat, color: d.color || '#666', summary: d.dpt_summary });
  });
  summaries.forEach(({ mat, color, summary }) => {
    [
      ['I peak', fmtMetric(summary.i_peak_abs_A, 'A')],
      ['V peak', fmtMetric(summary.v_peak_abs_V, 'V')],
      ['di/dt', fmtMetric(summary.di_dt_peak_A_per_s / 1e9, 'A/ns')],
      ['dv/dt', fmtMetric(summary.dv_dt_peak_V_per_s / 1e9, 'V/ns')],
      ['Energy', fmtMetric(summary.energy_abs_J * 1e6, 'uJ')]
    ].forEach(([label, value]) => {
      const card = document.createElement('div');
      card.className = 'metric-card';
      card.style.borderColor = withAlpha(color, 0.45);
      const labelEl = document.createElement('span');
      labelEl.className = 'label';
      labelEl.textContent = `${mat} ${label}`;
      const valueEl = document.createElement('span');
      valueEl.className = 'value';
      valueEl.textContent = value;
      card.appendChild(labelEl);
      card.appendChild(valueEl);
      grid.appendChild(card);
    });
  });
  return summaries.length;
}

function renderPlots() {
  destroyCharts();

  const modeKey = state.mode === 'dpt' ? 'transient' : state.mode;
  const familyNode = data[modeKey][state.family];
  const classNode = familyNode.classes[state.voltage];

  const modeLabel = state.mode === 'steady' ? 'Steady I-V' : state.mode === 'transient' ? 'Switching Response' : 'Double Pulse Test';
  document.getElementById('plot-title').textContent = state.mode === 'steady' ? 'FORWARD BIASING' : state.mode === 'transient' ? 'REVERSE RECOVERY' : 'DPT DUT CURRENT';
  document.getElementById('secondary-title').textContent = state.mode === 'steady'
    ? 'Reverse Breakdown'
    : state.mode === 'transient'
      ? 'Test Circuit'
      : 'DPT Circuit';

  const steadyForwardBlock = document.getElementById('steady-forward-block');
  const steadyReverseBlock = document.getElementById('steady-reverse-block');
  const transientWaveformBlock = document.getElementById('transient-waveform-block');
  const transientCircuitBlock = document.getElementById('transient-circuit-block');
  const dptResultsBlock = document.getElementById('dpt-results-block');
  const dptCircuitBlock = document.getElementById('dpt-circuit-block');
  const secondaryPanel = document.getElementById('secondary-panel');
  const panelGrid = document.querySelector('.panel-grid');
  const axisToggle = document.querySelector('.axis-toggle');

  show(steadyForwardBlock, state.mode === 'steady');
  show(steadyReverseBlock, state.mode === 'steady' && DISPLAY_REVERSE_PLOTS);
  show(transientWaveformBlock, state.mode === 'transient' || state.mode === 'dpt');
  show(transientCircuitBlock, state.mode === 'transient');
  show(dptResultsBlock, state.mode === 'dpt');
  show(dptCircuitBlock, state.mode === 'dpt');
  show(secondaryPanel, state.mode !== 'steady' || DISPLAY_REVERSE_PLOTS);
  show(axisToggle, state.mode === 'steady');
  panelGrid.classList.toggle('steady-forward-only', state.mode === 'steady' && !DISPLAY_REVERSE_PLOTS);

  if (state.mode === 'steady') {
    renderSteady(classNode);
  } else if (state.mode === 'transient') {
    renderTransient(classNode);
    renderSwitchingCircuit();
  } else if (state.mode === 'dpt') {
    renderTransient(classNode);
    renderDptMetrics(classNode);
    renderDPTCircuit();
  }
}

function renderDeckTable() {
  const body = document.getElementById('deck-body');
  body.innerHTML = '';

  data.deck_table
    .filter(row => row.family === data.meta.families[state.family] && row.voltage_class === state.voltage)
    .forEach(row => {
      const tr = document.createElement('tr');

      const tdMat = document.createElement('td');
      tdMat.textContent = row.material;
      tr.appendChild(tdMat);

      const tdV = document.createElement('td');
      tdV.textContent = row.voltage_class;
      tr.appendChild(tdV);

      const tdStatus = document.createElement('td');
      tdStatus.innerHTML = `<div class="status-stack">${statusBadge('dc', row.steady_status)}${statusBadge('dpt', row.switching_status)}</div>`;
      tr.appendChild(tdStatus);

      const tdS = document.createElement('td');
      tdS.innerHTML = `<a href="${row.steady_deck}">steady.in</a>`;
      tr.appendChild(tdS);

      const tdT = document.createElement('td');
      tdT.innerHTML = `<a href="${row.switching_deck}">switching.in</a>`;
      tr.appendChild(tdT);

      body.appendChild(tr);
    });
}

function statusBadge(kind, status) {
  const value = status || 'not_run';
  const label = {
    ok: 'ok',
    stale: 'stale',
    failed: 'failed',
    not_run: 'not run',
  }[value] || value;
  const css = `status-${value.replace(/[^a-z0-9_-]/gi, '_')}`;
  return `<span class="status-badge ${css}">${kind} ${label}</span>`;
}

// ─── Device cross-section SVG ───────────────────────────────────────────────

// P-type → red hue; N-type → blue hue.
// Doping magnitude maps lightness: low doping = light shade, high = dark shade.
function layerColor(nd_cm3, isP) {
  const logN = Math.log10(Math.max(nd_cm3, 1e13));
  // t: 0 at 1e13 (lightest), 1 at 1e20 (darkest)
  const t = Math.max(0, Math.min(1, (logN - 13) / 7));
  const L = Math.round(88 - t * 62); // 88% (very light) → 26% (very dark)
  const hue = isP ? 355 : 215;       // red : blue
  return `hsl(${hue},75%,${L}%)`;
}

const MAT_COLOR = { 'Si': '#1f77b4', '4H-SiC': '#ff7f0e', 'GaN': '#2ca02c' };
const MAT_ORDER = ['Si', '4H-SiC', 'GaN'];

// Format doping: 1e18 → "1e18", 3.76e15 → "3.8e15"
function fmtNd(nd) {
  const exp = Math.floor(Math.log10(nd));
  const mant = nd / Math.pow(10, exp);
  const m = parseFloat(mant.toFixed(1));
  return (m === 1.0 ? '' : m + '×') + `10¹${exp > 9 ? '' : ''}${exp}`;
}

// Simple scientific for tight spaces: "~1e18"
function fmtNdShort(nd) {
  const exp = Math.round(Math.log10(nd));
  return `~1e${exp}`;
}

function fmtUm(um) {
  if (um >= 100) return `${um.toFixed(0)} µm`;
  if (um >= 10)  return `${um.toFixed(0)} µm`;
  if (um >= 1)   return `${um.toFixed(1)} µm`;
  return `${(um * 1000).toFixed(0)} nm`;
}

function deviceLayers(family, design) {
  const { Nd_cm3, Drift_um, Substrate_um } = design;
  if (family === 'pin') return [
    { label: 'p+',  h_um: design.Emitter_um || Math.max(2.0, 0.04 * Drift_um), nd: 5e18,  p: true  },
    { label: 'n−',  h_um: Drift_um,     nd: Nd_cm3, p: false },
    { label: 'n+',  h_um: Substrate_um, nd: 1e18,  p: false },
  ];
  if (family === 'schottky') return [
    { label: 'n−',  h_um: Drift_um,     nd: Nd_cm3, p: false },
    { label: 'n+',  h_um: Substrate_um, nd: 1e18,  p: false },
  ];
  // mosfet — layer depths from actual deck gaussians:
  // n+ source: char=0.1µm → ~0.2µm, peak 1e20
  // p-body:    char=0.5µm → ~1.5µm, peak 1e17
  // n+ substrate: uniform 1e19
  return [
    { label: 'n+ src', h_um: 0.2,          nd: 1e20,  p: false },
    { label: 'p-body', h_um: 1.5,          nd: 1e17,  p: true  },
    { label: 'n−',     h_um: Drift_um,     nd: Nd_cm3, p: false },
    { label: 'n+ sub', h_um: Substrate_um, nd: 1e19,  p: false },
  ];
}

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

function renderDeviceSVG() {
  const svg = document.getElementById('dev-svg');
  svg.innerHTML = '';
  const legend = document.getElementById('svg-legend');
  legend.innerHTML = '';

  const rows = data.deck_table.filter(
    r => r.family === data.meta.families[state.family] && r.voltage_class === state.voltage && r.design
  );
  if (!rows.length) return;

  const ordered = MAT_ORDER.map(m => rows.find(r => r.material === m)).filter(Boolean);
  const nCols = ordered.length;

  // ── True-to-scale: find thickest device, scale all relative to it ──
  const totals = ordered.map(row =>
    deviceLayers(state.family, row.design).reduce((s, l) => s + l.h_um, 0)
  );
  const maxH_um = Math.max(...totals);

  const SVG_W = 300, SVG_H = 210;
  const COL_GAP = 8;
  const CONTACT_H = 7;  // px
  const LABEL_H = 16;   // px reserved at top for material name
  const BOTTOM_Y = SVG_H - 2; // all devices are bottom-aligned (cathode/drain at same Y)
  const SEMI_MAX_H = SVG_H - LABEL_H - CONTACT_H * 2 - 4; // max semiconductor px height
  const PX_PER_UM = SEMI_MAX_H / maxH_um;

  const colW = (SVG_W - COL_GAP * (nCols + 1)) / nCols;

  // Update SVG viewBox to actual height
  svg.setAttribute('viewBox', `0 0 ${SVG_W} ${SVG_H}`);

  const topLabel  = state.family === 'mosfet' ? 'S' : state.family === 'pin' ? 'A' : 'M';
  const botLabel  = state.family === 'mosfet' ? 'D' : 'K';

  ordered.forEach((row, ci) => {
    const x0 = COL_GAP + ci * (colW + COL_GAP);
    const layers = deviceLayers(state.family, row.design);
    const totalH_um = layers.reduce((s, l) => s + l.h_um, 0);
    const semiPx = totalH_um * PX_PER_UM;  // actual scaled height of this device

    // Bottom contact sits at BOTTOM_Y
    const bcY = BOTTOM_Y - CONTACT_H;
    // Semiconductor block sits above bottom contact
    const semiBottomY = bcY;
    const semiTopY = semiBottomY - semiPx;
    // Top contact sits above semiconductor
    const tcY = semiTopY - CONTACT_H;
    // Material label sits above top contact
    const lblY = tcY - 3;

    // Material label
    const matColor = MAT_COLOR[row.material] || '#666';
    svg.appendChild(svgEl('text', {
      x: x0 + colW / 2, y: lblY,
      'text-anchor': 'middle', 'font-size': '9',
      'font-family': 'Space Grotesk, sans-serif', 'font-weight': '600',
      fill: matColor
    })).textContent = row.material;

    // Top contact
    svg.appendChild(svgEl('rect', {
      x: x0, y: tcY, width: colW, height: CONTACT_H,
      fill: '#888', rx: '1.5'
    }));
    svg.appendChild(svgEl('text', {
      x: x0 + colW / 2, y: tcY + CONTACT_H - 1.5,
      'text-anchor': 'middle', 'font-size': '6',
      'font-family': 'IBM Plex Mono, monospace', fill: '#fff'
    })).textContent = topLabel;

    // Semiconductor layers (draw top→bottom)
    let curY = semiTopY;
    layers.forEach(layer => {
      const layerPx = (layer.h_um / totalH_um) * semiPx;
      svg.appendChild(svgEl('rect', {
        x: x0, y: curY, width: colW, height: layerPx,
        fill: layerColor(layer.nd, layer.p),
        stroke: 'rgba(255,255,255,0.3)', 'stroke-width': '0.5'
      }));

      // Labels inside layer — show as much as fits
      const midY = curY + layerPx / 2;
      const dopStr  = fmtNdShort(layer.nd);  // e.g. "~1e18"
      const thkStr  = fmtUm(layer.h_um);     // e.g. "7.5 µm"
      const labelC  = 'rgba(255,255,255,0.95)';
      const monoF   = 'IBM Plex Mono, monospace';

      if (layerPx >= 36) {
        // 3 lines: type | doping | thickness
        svg.appendChild(svgEl('text', {
          x: x0 + colW / 2, y: midY - 7,
          'text-anchor': 'middle', 'font-size': '7.5', 'font-weight': '600',
          'font-family': monoF, fill: labelC
        })).textContent = layer.label;
        svg.appendChild(svgEl('text', {
          x: x0 + colW / 2, y: midY + 1,
          'text-anchor': 'middle', 'font-size': '6.5',
          'font-family': monoF, fill: 'rgba(255,255,255,0.8)'
        })).textContent = dopStr + ' cm⁻³';
        svg.appendChild(svgEl('text', {
          x: x0 + colW / 2, y: midY + 9,
          'text-anchor': 'middle', 'font-size': '6.5',
          'font-family': monoF, fill: 'rgba(255,255,255,0.8)'
        })).textContent = thkStr;
      } else if (layerPx >= 20) {
        // 2 lines: type | thickness
        svg.appendChild(svgEl('text', {
          x: x0 + colW / 2, y: midY - 1,
          'text-anchor': 'middle', 'font-size': '7', 'font-weight': '600',
          'font-family': monoF, fill: labelC
        })).textContent = layer.label;
        svg.appendChild(svgEl('text', {
          x: x0 + colW / 2, y: midY + 7,
          'text-anchor': 'middle', 'font-size': '6',
          'font-family': monoF, fill: 'rgba(255,255,255,0.8)'
        })).textContent = thkStr;
      } else if (layerPx >= 10) {
        // 1 line: type only
        svg.appendChild(svgEl('text', {
          x: x0 + colW / 2, y: midY + 2.5,
          'text-anchor': 'middle', 'font-size': '6.5',
          'font-family': monoF, fill: labelC
        })).textContent = layer.label;
      }

      curY += layerPx;
    });

    // Bottom contact
    svg.appendChild(svgEl('rect', {
      x: x0, y: bcY, width: colW, height: CONTACT_H,
      fill: '#888', rx: '1.5'
    }));
    svg.appendChild(svgEl('text', {
      x: x0 + colW / 2, y: bcY + CONTACT_H - 1.5,
      'text-anchor': 'middle', 'font-size': '6',
      'font-family': 'IBM Plex Mono, monospace', fill: '#fff'
    })).textContent = botLabel;

    // Thickness annotation: total µm on right of rightmost column
    if (ci === nCols - 1) {
      const thickLabel = totalH_um >= 10 ?
        `${totalH_um.toFixed(0)}µm` :
        totalH_um >= 1 ? `${totalH_um.toFixed(1)}µm` : `${(totalH_um * 1000).toFixed(0)}nm`;
      svg.appendChild(svgEl('text', {
        x: x0 + colW + 3, y: semiTopY + semiPx / 2 + 3,
        'font-size': '6.5', 'font-family': 'IBM Plex Mono, monospace', fill: '#888'
      })).textContent = thickLabel;
    }
  });

  // Legend
  [
    { label: 'n− (low doping)', nd: 1e14, p: false },
    { label: 'n+ (high doping)', nd: 1e19, p: false },
    { label: 'p  (low doping)',  nd: 5e16, p: true  },
    { label: 'p+ (high doping)', nd: 5e18, p: true  },
  ].forEach(item => {
    const wrap = document.createElement('div');
    wrap.className = 'svg-legend-item';
    const sw = document.createElement('div');
    sw.className = 'svg-legend-swatch';
    sw.style.background = layerColor(item.nd, item.p);
    const tx = document.createElement('span');
    tx.textContent = item.label;
    wrap.appendChild(sw); wrap.appendChild(tx);
    legend.appendChild(wrap);
  });
  const note = document.createElement('div');
  note.className = 'svg-legend-item';
  note.style.color = '#8a8a8a';
  note.textContent = '(to scale)';
  legend.appendChild(note);
}

// ─── Switching circuit diagram (voltage-pulse reverse recovery) ──────────
function renderSwitchingCircuit() {
  const svg = document.getElementById('circuit-svg');
  svg.innerHTML = '';
  const NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, text) {
    const e = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k,v]) => e.setAttribute(k,v));
    if (text) e.textContent = text;
    svg.appendChild(e);
    return e;
  }
  function line(x1,y1,x2,y2,extra={}) {
    el('line', {x1,y1,x2,y2,stroke:'#333','stroke-width':'1.8',...extra});
  }
  function txt(x,y,t,size='10',anchor='middle',weight='400') {
    el('text', {x,y,'text-anchor':anchor,'font-size':size,
      'font-family':'IBM Plex Mono, monospace','font-weight':weight,fill:'#333'}, t);
  }
  function txtMuted(x,y,t,size='8.5') {
    el('text', {x,y,'text-anchor':'middle','font-size':size,
      'font-family':'Space Grotesk, sans-serif',fill:'#888'}, t);
  }
  function resistor(x,y,w,h,label,value) {
    el('rect', {x:x-w/2,y:y-h/2,width:w,height:h,fill:'none',stroke:'#333','stroke-width':'1.5',rx:'2'});
    if (label) txt(x,y+h/2+11,label,'8.5');
    if (value) txtMuted(x,y+h/2+20,value,'7.5');
  }
  function diodeSymbol(x,y,dir,label) {
    // dir: 'up' (anode bottom, cathode top) or 'down'
    const s = 12;
    if (dir === 'up') {
      el('polygon', {points:`${x-s},${y+s/2} ${x+s},${y+s/2} ${x},${y-s/2}`,fill:'#333'});
      line(x-s,y-s/2,x+s,y-s/2);
    } else {
      el('polygon', {points:`${x-s},${y-s/2} ${x+s},${y-s/2} ${x},${y+s/2}`,fill:'#333'});
      line(x-s,y+s/2,x+s,y+s/2);
    }
    if (label) txt(x+18,y+3,label,'8.5','start');
  }
  function inductor(x,y,w,label,value) {
    let d = `M ${x-w/2} ${y}`;
    const n = 4, r = w/(2*n);
    for (let i=0;i<n;i++) d += ` a ${r},${r*0.8} 0 0,1 ${2*r},0`;
    el('path', {d,fill:'none',stroke:'#333','stroke-width':'1.8'});
    if (label) txt(x,y-12,label,'8.5');
    if (value) txtMuted(x,y-4,value,'7.5');
  }
  function vpulse(x,y,r,label) {
    el('circle', {cx:x,cy:y,r,fill:'none',stroke:'#333','stroke-width':'1.5'});
    // pulse symbol inside
    const s = r*0.5;
    el('polyline', {points:`${x-s},${y+s*0.3} ${x-s*0.3},${y+s*0.3} ${x-s*0.3},${y-s*0.3} ${x+s*0.3},${y-s*0.3} ${x+s*0.3},${y+s*0.3} ${x+s},${y+s*0.3}`,
      fill:'none',stroke:'#333','stroke-width':'1.2'});
    txt(x,y+r+12,label,'8.5');
  }
  function ground(x,y) {
    line(x,y,x,y+6);
    line(x-8,y+6,x+8,y+6);
    line(x-5,y+10,x+5,y+10);
    line(x-2,y+14,x+2,y+14);
  }

  // Layout: VPULSE → R_SERIES → DUT (TCAD diode) → GND
  //                              ↑
  //         Reverse-bias pulse drives DUT from forward → reverse
  const cx = 260, topY = 30, botY = 240;
  const leftX = 100, rightX = 420;

  // Title
  txt(260, 18, 'Voltage-Pulse Reverse Recovery', '11', 'middle', '600');

  // VPULSE source on left
  vpulse(leftX, 130, 22, 'V_PULSE');
  txtMuted(leftX, 168, '−V_R → +V_F → −V_R', '7');

  // + / - labels
  txt(leftX-8, 100, '+', '10', 'end');
  txt(leftX-8, 162, '−', '10', 'end');

  // Top wire from V+ to R_SERIES
  line(leftX, 108, leftX, 60);
  line(leftX, 60, 220, 60);

  // R_SERIES
  resistor(260, 60, 50, 16, 'R_SERIES', '50 Ω');

  // Wire from R to DUT anode
  line(285, 60, 350, 60);

  // Node label
  el('circle', {cx:350,cy:60,r:3,fill:'#1c7c54'});
  txt(358, 52, 'Anode', '8', 'start', '600');

  // DUT diode (vertical, anode top, cathode bottom)
  line(350, 60, 350, 105);
  diodeSymbol(350, 120, 'down', '');
  txt(375, 120, 'DUT', '10', 'start', '700');
  txtMuted(375, 132, '(TCAD PIN)', '7.5');
  line(350, 135, 350, 180);

  // Node label cathode
  el('circle', {cx:350,cy:180,r:3,fill:'#1c7c54'});
  txt(358, 195, 'Cathode', '8', 'start', '600');

  // Ground at bottom
  line(350, 180, 350, 215);
  ground(350, 215);

  // Bottom wire back to V-
  line(leftX, 152, leftX, 215);
  line(leftX, 215, 350, 215);

  // Ground symbol on left too
  ground(leftX, 215);
}

// ─── DPT circuit diagram (clamped inductive load) ───────────────────────
function renderDPTCircuit() {
  const svg = document.getElementById('dpt-circuit-svg');
  svg.innerHTML = '';
  const NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, text) {
    const e = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k,v]) => e.setAttribute(k,v));
    if (text) e.textContent = text;
    svg.appendChild(e);
    return e;
  }
  function line(x1,y1,x2,y2,extra={}) {
    el('line', {x1,y1,x2,y2,stroke:'#333','stroke-width':'1.8',...extra});
  }
  function txt(x,y,t,size='10',anchor='middle',weight='400') {
    el('text', {x,y,'text-anchor':anchor,'font-size':size,
      'font-family':'IBM Plex Mono, monospace','font-weight':weight,fill:'#333'}, t);
  }
  function txtMuted(x,y,t,size='8.5') {
    el('text', {x,y,'text-anchor':'middle','font-size':size,
      'font-family':'Space Grotesk, sans-serif',fill:'#888'}, t);
  }
  function ground(x,y) {
    line(x,y,x,y+6);
    line(x-8,y+6,x+8,y+6);
    line(x-5,y+10,x+5,y+10);
    line(x-2,y+14,x+2,y+14);
  }

  const mosfetDut = state.family === 'mosfet';

  // Title
  txt(260, 18, 'Double Pulse Test', '11', 'middle', '600');

  // ── V_DC supply (left) ──
  el('circle', {cx:80,cy:100,r:18,fill:'none',stroke:'#333','stroke-width':'1.5'});
  txt(80,104,'V_DC','8.5');
  txt(64,88,'+','10','end');
  txt(64,118,'−','10','end');

  // top rail from V_DC
  line(80,82,80,45);
  line(80,45,260,45);
  // node 10 label
  el('circle', {cx:260,cy:45,r:3,fill:'#1c7c54'});
  txt(268,38,'node 10','7.5','start','600');

  // ── L_LOAD (vertical, from DC bus to mid-point) ──
  const lx = 260, ly_top = 45, ly_bot = 120;
  line(lx, ly_top, lx, ly_top+12);
  // inductor coils
  let d = `M ${lx} ${ly_top+12}`;
  for (let i=0;i<4;i++) {
    d += ` c 15,0 15,14 0,14`;
  }
  el('path', {d,fill:'none',stroke:'#333','stroke-width':'1.8'});
  line(lx, ly_top+12+56, lx, ly_bot+10);
  txt(lx+20, ly_top+42, 'L_LOAD', '8.5', 'start');
  txtMuted(lx+20, ly_top+53, '100 µH', '7.5');

  // ── mid-point node ──
  const midY = 140;
  line(260, ly_bot+10, 260, midY);
  el('circle', {cx:260,cy:midY,r:4,fill:'#1c7c54'});
  txt(268,135,'node 3','7.5','start','600');
  txtMuted(268,148,'(mid-point)','7');

  // ── Low-side switch: TCAD MOSFET in MOSFET mode, compact switch in diode mode ──
  const mx = 260, my = 200;
  line(mx, midY, mx, my-22);
  // MOSFET symbol
  // gate line from left
  line(mx-30, my, mx-12, my);
  line(mx-12, my-16, mx-12, my+16, {'stroke-width':'2.5'});
  // channel line
  line(mx-8, my-14, mx-8, my+14, {'stroke-width':'1.5'});
  // drain
  line(mx-8, my-12, mx, my-12);
  line(mx, my-12, mx, my-22);
  // source
  line(mx-8, my+12, mx, my+12);
  line(mx, my+12, mx, my+30);
  // arrow on source
  el('polygon', {points:`${mx-3},${my+6} ${mx+3},${my+6} ${mx},${my+12}`,fill:'#333'});
  // labels
  txt(mx-34, my+4, 'G', '8', 'end', '600');
  txt(mx+8, my-16, 'D', '8', 'start', '600');
  txt(mx+8, my+18, 'S', '8', 'start', '600');
  txt(mx, my+50, mosfetDut ? 'Q_DUT' : 'M_SW', '9', 'middle', '700');
  txtMuted(mx, my+62, mosfetDut ? '(TCAD MOSFET)' : '(compact switch)', '7.5');

  // ── Gate drive ──
  const gx = 140, gy = my;
  el('circle', {cx:gx,cy:gy,r:15,fill:'none',stroke:'#333','stroke-width':'1.5'});
  // pulse inside
  const ps = 6;
  el('polyline', {points:`${gx-ps},${gy+ps*0.3} ${gx-ps*0.3},${gy+ps*0.3} ${gx-ps*0.3},${gy-ps*0.3} ${gx+ps*0.3},${gy-ps*0.3} ${gx+ps*0.3},${gy+ps*0.3} ${gx+ps},${gy+ps*0.3}`,
    fill:'none',stroke:'#333','stroke-width':'1'});
  txt(gx, gy+28, 'V_GATE', '8');
  txtMuted(gx, gy+38, 'Double pulse', '7');

  // Gate resistor
  line(gx+15, gy, gx+28, gy);
  el('rect', {x:gx+28,y:gy-5,width:24,height:10,fill:'none',stroke:'#333','stroke-width':'1.2',rx:'2'});
  txt(gx+40, gy+18, 'R_G', '7.5');
  txtMuted(gx+40, gy+27, '5 Ω', '6.5');
  line(gx+52, gy, mx-30, gy);

  // Source to GND
  line(mx, my+30, mx, my+45);
  ground(mx, my+45);

  // ── V_DC return to GND ──
  line(80, 118, 80, my+45+6);
  line(80, my+45+6, 260, my+45+6);

  // ── Free-wheeling diode: compact diode in MOSFET mode, TCAD diode DUT in diode mode ──
  const dx = 380;
  line(260, midY, dx, midY); // horizontal from mid-point
  line(dx, midY, dx, midY-20);
  // diode triangle (pointing up = anode at bottom)
  const ds = 10;
  el('polygon', {points:`${dx-ds},${midY-30} ${dx+ds},${midY-30} ${dx},${midY-30-16}`,fill:'#333'});
  line(dx-ds, midY-30-16, dx+ds, midY-30-16);
  line(dx, midY-30-16, dx, 45);
  line(dx, 45, 260, 45);
  txt(dx+16, midY-35, mosfetDut ? 'D_FW' : 'D_DUT', '8.5', 'start', '600');
  txtMuted(dx+16, midY-24, mosfetDut ? 'Freewheeling' : '(TCAD diode)', '7');

  // ── Current path annotations ──
  // Arrow showing load current direction
  el('polygon', {points:`${lx-6},${ly_top+30} ${lx+6},${ly_top+30} ${lx},${ly_top+38}`,fill:'#1c7c54',opacity:'0.5'});
  txtMuted(lx-30, ly_top+38, 'I_L', '8');
}

function renderAll() {
  const isProcess = state.mode === 'process';
  show(byId('family-row'), !isProcess);
  show(byId('voltage-row'), !isProcess);
  show(byId('material-row'), !isProcess);
  show(byId('drift-calc-bar'), !isProcess);
  show(document.querySelector('.panel-grid'), !isProcess);
  show(byId('main-footer'), !isProcess);
  show(byId('process-section'), isProcess);
  if (isProcess) {
    calcProcess();
    return;
  }
  buildMaterialRow();
  buildVoltageRow();
  renderPlots();
  renderDeckTable();
  renderDeviceSVG();
}

function boot() {
  if (!data) {
    document.body.innerHTML = '<main><p class="no-data">No device_data.js found. Run plot_results.py after simulations.</p></main>';
    return;
  }

  document.getElementById('kpi').textContent = `Loaded: ${data.meta.loaded_variants || 0} variants`;
  buildModeRow();
  buildFamilyRow();
  buildVoltageRow();
  buildMaterialRow();
  renderAll();
  calcBV();
}

// ─── BV Design Calculator (Baliga NPT) ─────────────────────────────────────
// Ref: B.J. Baliga, "Fundamentals of Power Semiconductor Devices", 2nd ed.
//   NPT (non-punch-through) 1-D abrupt junction:
//     BV = ε_s · E_c² / (2·q·N_d)   →  N_d = ε_s · E_c² / (2·q·BV)
//     W_d = 2·BV / E_c
//   For WBG: E_c(N_d) = E_c0 · (N_d / 1e16)^(1/8)   (Konstantinov/Baliga)
const CALC_MATS = {
  Si:  { eps_r: 11.7, Ec0: 3.0e5, scaling: false },
  SiC: { eps_r: 9.7,  Ec0: 2.2e6, scaling: true  },
  GaN: { eps_r: 9.0,  Ec0: 3.3e6, scaling: true  },
};

function voltageClassToBV(voltageClass) {
  if (!voltageClass) return null;
  const normalized = voltageClass.trim().toLowerCase();
  if (normalized.endsWith('kv')) {
    return Math.round(parseFloat(normalized) * 1000);
  }
  if (normalized.endsWith('v')) {
    return Math.round(parseFloat(normalized));
  }
  return null;
}

function syncCalcBVToSelection() {
  const bv = voltageClassToBV(state.voltage);
  const input = document.getElementById('calc-bv');
  if (input && Number.isFinite(bv)) {
    input.value = String(bv);
    calcBV();
  }
}

function calcBV() {
  const q  = 1.602e-19;
  const e0 = 8.854e-14; // F/cm

  const mat = document.getElementById('calc-mat').value;
  const BV  = parseFloat(document.getElementById('calc-bv').value);
  if (!BV || BV <= 0) return;

  const { eps_r, Ec0, scaling } = CALC_MATS[mat];
  const eps_s = eps_r * e0;
  let Nd, Ec;

  if (!scaling) {
    Ec = Ec0;
    Nd = eps_s * Ec * Ec / (2 * q * BV);
  } else {
    // Iterative: Ec depends on Nd
    Nd = eps_s * Ec0 * Ec0 / (2 * q * BV); // seed
    for (let i = 0; i < 50; i++) {
      Ec = Ec0 * Math.pow(Nd / 1e16, 1 / 8);
      const Nd_new = eps_s * Ec * Ec / (2 * q * BV);
      if (Math.abs(Nd_new - Nd) / Nd < 1e-10) break;
      Nd = Nd_new;
    }
    Ec = Ec0 * Math.pow(Nd / 1e16, 1 / 8);
  }

  const Wd_cm = 2 * BV / Ec;
  const Wd_um = Wd_cm * 1e4;

  document.getElementById('calc-nd').textContent = Nd.toExponential(2) + ' cm⁻³  (max)';
  document.getElementById('calc-wd').textContent = Wd_um.toFixed(1) + ' µm  (min)';
  document.getElementById('calc-ec').textContent = (Ec / 1e5).toFixed(1) + ' × 10⁵ V/cm';
}

document.getElementById('calc-mat').addEventListener('change', calcBV);
document.getElementById('calc-bv').addEventListener('input', calcBV);

// ─── Al Activation Model (4H-SiC) ──────────────────────────────────────────
// Calibrated from Victory Process simulations (Simonka TU Wien 2018)
const AL_kB = 8.617e-5; // eV/K
const AL_A_Rp = 1.8538, AL_B_Rp = 0.9129;   // Rp(nm) = A × E^B
const AL_A_dRp = 2.6184, AL_B_dRp = 0.6254; // ΔRp(nm) = A × E^B
const AL_f_a = 1.2393, AL_f_b = 0.5327, AL_f_c = 0.03340; // channeling
const AL_Z_sol = 1.18e26, AL_Ea_sol = 2.577; // C_ss Arrhenius (solid solubility)
const AL_Z_kap = 5.70e6, AL_Ea_kap = 2.717;  // κ Arrhenius

function alRp(E) { return AL_A_Rp * Math.pow(E, AL_B_Rp); }
function alDRp(E) { return AL_A_dRp * Math.pow(E, AL_B_dRp); }
function alF(E) { return AL_f_a - AL_f_b * Math.exp(-AL_f_c * E); }
function alCpeak(E, dose) {
  return alF(E) * dose / (Math.sqrt(2 * Math.PI) * alDRp(E) * 1e-7);
}
function alCss(T_C) {
  return AL_Z_sol * Math.exp(-AL_Ea_sol / (AL_kB * (T_C + 273.15)));
}
function alKappa(T_C) {
  return AL_Z_kap * Math.exp(-AL_Ea_kap / (AL_kB * (T_C + 273.15)));
}
function alCact(C_tot, T_C, t_min) {
  const C_ss = alCss(T_C);
  const kappa = alKappa(T_C);
  const C_inf = C_tot / (1 + C_tot / C_ss);  // steady-state target
  return Math.min(Math.max(C_inf * (1 - Math.exp(-kappa * t_min)), 0), C_tot);
}

function calcProcess() {
  const E = parseFloat(document.getElementById('proc-energy').value);
  const dose = parseFloat(document.getElementById('proc-dose').value);
  const T = parseFloat(document.getElementById('proc-temp').value);
  const t = parseFloat(document.getElementById('proc-time').value);
  if (!E || E <= 0 || !dose || dose <= 0 || !T || !t || t <= 0) return;

  const Rp = alRp(E);
  const dRp = alDRp(E);
  const C_peak = alCpeak(E, dose);
  const C_ss = alCss(T);
  const C_act = alCact(C_peak, T, t);
  const R_act = C_peak > 0 ? C_act / C_peak : 0;

  document.getElementById('proc-rp').textContent = Rp.toFixed(1) + ' nm';
  document.getElementById('proc-drp').textContent = dRp.toFixed(1) + ' nm';
  document.getElementById('proc-cpeak').textContent = C_peak.toExponential(2) + ' cm⁻³';
  document.getElementById('proc-csol').textContent = C_ss.toExponential(2) + ' cm⁻³';
  document.getElementById('proc-cact').textContent = C_act.toExponential(2) + ' cm⁻³';
  document.getElementById('proc-ract').textContent = (R_act * 100).toFixed(1) + '%';

  renderProcCharts(E, dose, T, t, C_peak);
}

function renderProcCharts(E, dose, T, t, C_peak) {
  if (procTempChart) { procTempChart.destroy(); procTempChart = null; }
  if (procTimeChart) { procTimeChart.destroy(); procTimeChart = null; }
  if (!C_peak || C_peak <= 0) return;

  const currentRact = alCact(C_peak, T, t) / C_peak * 100;

  // Chart 1: R_act vs Temperature
  const temps = [], ractsT = [];
  for (let tc = 1400; tc <= 1900; tc += 5) {
    temps.push(tc);
    ractsT.push(alCact(C_peak, tc, t) / C_peak * 100);
  }
  var procChartOpts = function(xLabel, xMin, xMax) {
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { position: 'top' } },
      scales: {
        x: { type: 'linear', title: { display: true, text: xLabel }, min: xMin, max: xMax, grid: { color: 'rgba(0,0,0,0.08)' } },
        y: { type: 'linear', title: { display: true, text: 'Activation Ratio (%)' }, min: 0, max: 105, grid: { color: 'rgba(0,0,0,0.08)' } }
      }
    };
  };
  procTempChart = new Chart(document.getElementById('proc-temp-chart'), {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'R_act at t = ' + t + ' min',
          data: temps.map((x, i) => ({ x, y: ractsT[i] })),
          borderColor: '#1c7c54',
          backgroundColor: 'rgba(28,124,84,0.08)',
          borderWidth: 2, pointRadius: 0, showLine: true, tension: 0.3, fill: true
        },
        {
          label: 'Current (' + T + ' °C)',
          data: [{ x: T, y: currentRact }],
          borderColor: '#d62728', backgroundColor: '#d62728',
          pointRadius: 7, showLine: false
        }
      ]
    },
    options: procChartOpts('Temperature (°C)', 1400, 1900)
  });

  // Chart 2: R_act vs Time (fixed 120 min axis)
  const times = [], ractsTime = [];
  for (let ti = 0; ti <= 120; ti += 0.6) {
    times.push(ti);
    ractsTime.push(alCact(C_peak, T, ti) / C_peak * 100);
  }
  procTimeChart = new Chart(document.getElementById('proc-time-chart'), {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'R_act at T = ' + T + ' °C',
          data: times.map((x, i) => ({ x, y: ractsTime[i] })),
          borderColor: '#1f77b4',
          backgroundColor: 'rgba(31,119,180,0.08)',
          borderWidth: 2, pointRadius: 0, showLine: true, tension: 0.3, fill: true
        },
        {
          label: 'Current (' + t + ' min)',
          data: [{ x: t, y: currentRact }],
          borderColor: '#d62728', backgroundColor: '#d62728',
          pointRadius: 7, showLine: false
        }
      ]
    },
    options: procChartOpts('Anneal Time (min)', 0, 125)
  });
}

['proc-energy', 'proc-temp', 'proc-time'].forEach(function(id) {
  document.getElementById(id).addEventListener('input', function() { if (state.mode === 'process') calcProcess(); });
});
document.getElementById('proc-dose').addEventListener('change', function() { if (state.mode === 'process') calcProcess(); });
byId('btn-log').addEventListener('click', function() { setLogY(true); });
byId('btn-lin').addEventListener('click', function() { setLogY(false); });

boot();
