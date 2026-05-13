const ANALYSIS_MATERIALS = {
  Si: { label: 'Si', mu_n: 1350, junction: { pin: 0.90, schottky: 0.55 } },
  SiC: { label: '4H-SiC', mu_n: 950, junction: { pin: 2.80, schottky: 1.35 } },
  GaN: { label: 'GaN', mu_n: 1000, junction: { pin: 3.00, schottky: 1.10 } },
};

let analysisInitialized = false;

function analysisNumber(id, fallback) {
  const value = parseFloat(document.getElementById(id)?.value);
  return Number.isFinite(value) ? value : fallback;
}

function fmtAnalysis(value, unit = '', digits = 3) {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  let text;
  if (abs !== 0 && (abs < 0.01 || abs >= 10000)) text = value.toExponential(2);
  else if (abs >= 100) text = value.toFixed(1);
  else text = value.toFixed(digits).replace(/\.0+$/, '');
  return unit ? `${text} ${unit}` : text;
}

function syncAnalysisBVToSelection() {
  const bv = voltageClassToBV(state.voltage);
  const input = document.getElementById('analysis-bv');
  if (input && Number.isFinite(bv)) input.value = String(bv);
}

function solveAnalysisDrift(materialKey, bv) {
  const q = 1.602e-19;
  const e0 = 8.854e-14;
  const calcMat = CALC_MATS[materialKey];
  const analysisMat = ANALYSIS_MATERIALS[materialKey];
  if (!calcMat || !analysisMat || !Number.isFinite(bv) || bv <= 0) return null;

  const eps_s = calcMat.eps_r * e0;
  let nd = eps_s * calcMat.Ec0 * calcMat.Ec0 / (2 * q * bv);
  let ec = calcMat.Ec0;
  if (calcMat.scaling) {
    for (let i = 0; i < 50; i++) {
      ec = calcMat.Ec0 * Math.pow(nd / 1e16, 1 / 8);
      const nextNd = eps_s * ec * ec / (2 * q * bv);
      if (Math.abs(nextNd - nd) / nd < 1e-10) break;
      nd = nextNd;
    }
    ec = calcMat.Ec0 * Math.pow(nd / 1e16, 1 / 8);
  }

  const wdCm = 2 * bv / ec;
  const ronSp = wdCm / (q * analysisMat.mu_n * nd);
  return { nd, ec, wdUm: wdCm * 1e4, ronSp };
}

function analyticalLossEstimate(family, materialKey, bv, currentDensity, area, duty) {
  const drift = solveAnalysisDrift(materialKey, bv);
  const mat = ANALYSIS_MATERIALS[materialKey];
  if (!drift || !mat) return null;

  const current = currentDensity * area;
  const ron = drift.ronSp / area;
  const junction = mat.junction[family] ?? 0;
  const voltageDrop = family === 'mosfet'
    ? current * ron
    : junction + currentDensity * drift.ronSp;
  const conductionPower = family === 'mosfet'
    ? current * current * ron * duty
    : current * voltageDrop * duty;

  return { ...drift, current, ron, voltageDrop, conductionPower, junction };
}

function interpolateAtCurrent(voltage, current, targetCurrent) {
  if (!Array.isArray(voltage) || !Array.isArray(current) || voltage.length < 2) return null;
  const points = voltage
    .map((v, idx) => ({ v: Math.abs(v), i: Math.abs(current[idx]) }))
    .filter(point => Number.isFinite(point.v) && Number.isFinite(point.i))
    .sort((a, b) => a.i - b.i);
  if (points.length < 2 || targetCurrent < points[0].i || targetCurrent > points[points.length - 1].i) return null;
  for (let idx = 1; idx < points.length; idx++) {
    const lo = points[idx - 1];
    const hi = points[idx];
    if (targetCurrent <= hi.i) {
      const span = hi.i - lo.i;
      if (span <= 0) return hi.v;
      return lo.v + (hi.v - lo.v) * ((targetCurrent - lo.i) / span);
    }
  }
  return null;
}

function breakdownEstimate(reverse, threshold = 1e-5) {
  const voltage = reverse?.voltage || [];
  const current = reverse?.current || [];
  for (let idx = 0; idx < voltage.length; idx++) {
    if (Math.abs(current[idx]) >= threshold) return Math.abs(voltage[idx]);
  }
  return null;
}

function simulationAnalysisRows(family, currentDensity, area, duty, frequency) {
  const rows = [];
  const targetCurrent = currentDensity * area;
  const familyNode = data?.steady?.[family];
  if (!familyNode) return rows;

  Object.entries(familyNode.classes).forEach(([voltageClass, classNode]) => {
    Object.entries(classNode.materials).forEach(([material, steadyEntry]) => {
      const design = steadyEntry.design;
      if (!design) return;
      const transientEntry = data.transient?.[family]?.classes?.[voltageClass]?.materials?.[material];
      const forward = steadyEntry.forward_family?.length
        ? steadyEntry.forward_family[steadyEntry.forward_family.length - 1]
        : steadyEntry.forward;
      const vAtCurrent = interpolateAtCurrent(forward?.voltage, forward?.current, targetCurrent);
      const conductionPower = Number.isFinite(vAtCurrent) ? vAtCurrent * targetCurrent * duty : null;
      const energy = transientEntry?.dpt_summary?.energy_abs_J;
      const iRr = transientEntry?.dpt_summary?.i_rr_abs_A;
      const qRr = transientEntry?.dpt_summary?.q_rr_C;
      const trr = transientEntry?.dpt_summary?.t_rr_s;
      rows.push({
        material,
        voltageClass,
        designBV: design.Design_BV,
        targetBV: design.Target_BV,
        nd: design.Nd_cm3,
        drift: design.Drift_um,
        ronSp: design.Ronsp_ohm_cm2,
        vAtCurrent,
        conductionPower,
        breakdown: breakdownEstimate(steadyEntry.reverse),
        iRr,
        qRr,
        trr,
        switchingEnergy: energy,
        switchingPower: Number.isFinite(energy) ? energy * frequency : null,
        steadyStatus: steadyEntry.solver?.status || 'not_run',
        switchingStatus: transientEntry?.solver?.status || 'not_run',
      });
    });
  });
  return rows;
}

function setAnalysisMetric(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function renderAnalysisLab() {
  const family = state.family;
  const materialKey = document.getElementById('analysis-material')?.value || 'Si';
  const bv = analysisNumber('analysis-bv', 600);
  const currentDensity = analysisNumber('analysis-current-density', 100);
  const area = analysisNumber('analysis-area', 1);
  const frequency = analysisNumber('analysis-frequency', 100000);
  const duty = Math.min(Math.max(analysisNumber('analysis-duty', 0.5), 0), 1);
  const estimate = analyticalLossEstimate(family, materialKey, bv, currentDensity, area, duty);

  if (!estimate) return;
  setAnalysisMetric('analysis-nd', fmtAnalysis(estimate.nd, 'cm⁻³'));
  setAnalysisMetric('analysis-wd', fmtAnalysis(estimate.wdUm, 'µm'));
  setAnalysisMetric('analysis-ronsp', fmtAnalysis(estimate.ronSp, 'Ω·cm²', 4));
  setAnalysisMetric('analysis-vdrop', fmtAnalysis(estimate.voltageDrop, 'V'));
  setAnalysisMetric('analysis-pcond', fmtAnalysis(estimate.conductionPower, 'W'));
  setAnalysisMetric('analysis-current', fmtAnalysis(estimate.current, 'A'));

  const rows = simulationAnalysisRows(family, currentDensity, area, duty, frequency);
  const tbody = document.getElementById('analysis-comparison-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  rows.forEach(row => {
    const tr = document.createElement('tr');
    const values = [
      row.material,
      row.voltageClass,
      fmtAnalysis(row.designBV, 'V', 1),
      fmtAnalysis(row.ronSp, 'Ω·cm²', 4),
      fmtAnalysis(row.vAtCurrent, 'V'),
      fmtAnalysis(row.conductionPower, 'W'),
      fmtAnalysis(row.iRr, 'A'),
      fmtAnalysis(row.qRr ? row.qRr * 1e6 : null, 'µC'),
      fmtAnalysis(row.trr ? row.trr * 1e9 : null, 'ns'),
      fmtAnalysis(row.switchingEnergy ? row.switchingEnergy * 1e6 : null, 'µJ'),
      fmtAnalysis(row.switchingPower, 'W'),
    ];
    values.forEach(value => {
      const td = document.createElement('td');
      td.textContent = value;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function initAnalysisLab() {
  if (analysisInitialized) return;
  analysisInitialized = true;
  syncAnalysisBVToSelection();
  ['analysis-material', 'analysis-bv', 'analysis-current-density', 'analysis-area', 'analysis-frequency', 'analysis-duty']
    .forEach(id => {
      const node = document.getElementById(id);
      node?.addEventListener('input', renderAnalysisLab);
      node?.addEventListener('change', renderAnalysisLab);
    });
}