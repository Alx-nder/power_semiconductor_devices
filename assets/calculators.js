// Baliga-referenced drift calculator support.
// Ref: B.J. Baliga, "Fundamentals of Power Semiconductor Devices", 2nd ed.
//   W_D = 2·BV / E_C                                      Eq. 1.9
//   N_D = ε_s · E_C² / (2·q·BV)                           Eq. 1.10
//   R_on,sp = 4·BV² / (ε_s · μ_n · E_C³)                  Eq. 1.11, repeated as Eq. 3.24
//   R_on,sp = W_PP / (q · μ_n · N_D)                      Eq. 3.25
//   E_C(N_D): Si uses Eq. 3.22; 4H-SiC uses Eq. 3.23. GaN is a project extension.
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

