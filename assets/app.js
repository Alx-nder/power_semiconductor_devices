let data = window.DEVICE_DATA || null;
let forwardChart = null;
let reverseChart = null;
let transientChart = null;

const state = {
  family: 'pin',
  voltage: '600V',
  materials: { 'Si': true, '4H-SiC': true, 'GaN': true }
};

function byId(id) {
  return document.getElementById(id);
}

function show(node, isVisible) {
  node.hidden = !isVisible;
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
  const modeKey = 'steady';
  const classes = Object.keys(data[modeKey][state.family].classes);
  if (!classes.includes(state.voltage)) {
    state.voltage = classes[0];
    if (typeof syncAnalysisBVToSelection === 'function') syncAnalysisBVToSelection();
  }
  classes.forEach(v => {
    row.appendChild(btn(v, state.voltage === v, () => {
      state.voltage = v;
      if (typeof syncAnalysisBVToSelection === 'function') syncAnalysisBVToSelection();
      buildVoltageRow();
      renderAll();
    }));
  });
}

function buildMaterialRow() {
  const row = document.getElementById('material-row');
  row.querySelectorAll('.material-chip').forEach(n => n.remove());

  const colorMap = data.meta.colors;
  const modeKey = 'steady';
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
        renderAll();
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

function chartOptions(xLabel, yLabel, logY = false, yMax = null, yMin = null, xMin = null, xMax = null, showLegend = true) {
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
  const xAxis = {
    type: 'linear',
    title: { display: true, text: xLabel },
    grid: { color: 'rgba(0,0,0,0.08)' }
  };
  if (xMin !== null) xAxis.min = xMin;
  if (xMax !== null) xAxis.max = xMax;
  return {
    responsive: true,
    animation: false,
    plugins: {
      legend: { display: showLegend, position: 'top' }
    },
    scales: {
      x: xAxis,
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
        title: { display: true, text: 'Time (µs)' },
        grid: { color: 'rgba(0,0,0,0.08)' }
      },
      y: {
        type: 'linear',
        position: 'left',
        title: { display: true, text: 'DUT Current (A)' },
        grid: { color: 'rgba(0,0,0,0.08)' }
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

function forwardIvPoints(d) {
  const forwardSource = d.forward_family?.length ? d.forward_family[d.forward_family.length - 1] : d.forward;
  return (forwardSource?.voltage || []).map((voltage, idx) => ({
    x: Math.abs(voltage),
    y: Math.abs(forwardSource.current[idx] || 0)
  })).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y) && point.y > 0).sort((a, b) => a.x - b.x);
}

function reverseIvPoints(d) {
  return (d.reverse?.voltage || []).map((voltage, idx) => ({
    x: -Math.abs(voltage),
    y: Math.abs(d.reverse.current[idx] || 0)
  })).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y) && point.y > 0).sort((a, b) => a.x - b.x);
}

function steadyLogYMin(ivSets, lowerBound, yMax = null) {
  const values = ivSets.flatMap(dataset => dataset.data.map(point => point.y))
    .filter(value => Number.isFinite(value) && value > 0 && (yMax === null || value <= yMax));
  if (!values.length) return lowerBound;
  const minValue = Math.min(...values);
  const floor = Math.pow(10, Math.floor(Math.log10(minValue)));
  if (!Number.isFinite(floor) || floor <= 0) return lowerBound;
  return Math.max(floor, lowerBound);
}

function renderSteady(entry) {
  const forwardSets = [];
  const reverseSets = [];
  const selectedBv = typeof voltageClassToBV === 'function' ? voltageClassToBV(state.voltage) : null;

  Object.entries(entry.materials).forEach(([mat, d]) => {
    if (!state.materials[mat]) return;
    const color = d.color || '#666';
    const forwardPoints = forwardIvPoints(d);
    if (forwardPoints.length >= 2) {
      forwardSets.push({
        label: mat,
        data: forwardPoints,
        borderColor: color,
        backgroundColor: color,
        borderWidth: 2,
        pointRadius: 0,
        showLine: true,
        tension: 0
      });
    }
    const reversePoints = reverseIvPoints(d);
    if (reversePoints.length < 2) return;
    reverseSets.push({
      label: mat,
      data: reversePoints,
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      pointRadius: 0,
      showLine: true,
      tension: 0
    });
  });

  show(byId('forward-none'), !forwardSets.length);
  show(byId('reverse-none'), !reverseSets.length);

  if (forwardSets.length) {
    const steadyYLabel = state.family === 'mosfet' ? 'I_D (A)' : 'J (A/cm²)';
    const yMax = 200;
    const yMin = steadyLogYMin(forwardSets, 1e-3, yMax);
    forwardChart = new Chart(document.getElementById('forward-chart'), {
      type: 'scatter',
      data: { datasets: forwardSets },
      options: chartOptions('Voltage (V)', steadyYLabel, true, yMax, yMin, 0, 5, true)
    });
  }

  if (reverseSets.length) {
    const reverseYLabel = state.family === 'mosfet' ? '|I_D| (A)' : '|J| (A/cm²)';
    const yMin = steadyLogYMin(reverseSets, 1e-18);
    reverseChart = new Chart(document.getElementById('reverse-chart'), {
      type: 'scatter',
      data: { datasets: reverseSets },
      options: chartOptions('Voltage (V)', reverseYLabel, true, null, yMin, Number.isFinite(selectedBv) ? -Math.abs(selectedBv) : null, 0, false)
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
    sets.push(seriesDataset(`${mat} | I_DUT`, color, time.map(value => value * 1e6), current));
  });

  show(byId('transient-none'), !sets.length);

  if (sets.length) {
    transientChart = new Chart(document.getElementById('transient-chart'), {
      type: 'scatter',
      data: { datasets: sets },
      options: dptChartOptions()
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
    const frequency = analysisNumber('analysis-frequency', 100000);
    const switchingPower = Number.isFinite(summary.energy_abs_J) ? summary.energy_abs_J * frequency : null;
    [
      ['I_RM', fmtMetric((summary.i_rr_abs_A ?? summary.i_peak_abs_A), 'A')],
      ['Q_rr', fmtMetric((summary.q_rr_C ?? 0) * 1e6, 'uC')],
      ['t_rr', fmtMetric((summary.t_rr_s ?? 0) * 1e9, 'ns')],
      ['P_sw @ f', fmtMetric(switchingPower, 'W')]
    ].forEach(([label, value]) => {
      const card = document.createElement('div');
      card.className = 'metric-card';
      card.style.borderColor = color;
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

  const steadyNode = data.steady[state.family].classes[state.voltage];
  const transientNode = data.transient[state.family].classes[state.voltage];

  document.getElementById('plot-title').textContent = 'Steady I-V';
  document.getElementById('secondary-title').textContent = 'Double Pulse Test';

  renderSteady(steadyNode);
  renderTransient(transientNode);
  renderDptMetrics(transientNode);
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

function renderAll() {
  buildMaterialRow();
  buildVoltageRow();
  renderPlots();
  renderAnalysisLab();
  renderDeckTable();
}

function boot() {
  if (!data) {
    document.body.innerHTML = '<main><p class="no-data">No device_data.js found. Run plot_results.py after simulations.</p></main>';
    return;
  }

  document.getElementById('kpi').textContent = `Loaded: ${data.meta.loaded_variants || 0} variants`;
  if (typeof initAnalysisLab === 'function') initAnalysisLab();
  buildFamilyRow();
  buildVoltageRow();
  buildMaterialRow();
  renderAll();
}

boot();
