// Geodesia: proyecciones de los mapas de DCS, formatos de coordenadas y MGRS.
// Se usa tanto en el proceso principal (Node) como en las páginas (navegador).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Geo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Parámetros Transverse Mercator de cada mapa (los mismos que usa pydcs).
  // En la misión, x = norte e y = este.
  const THEATRES = {
    Caucasus: { cm: 33, fe: -99516.9999999732, fn: -4998114.999999984, magvar: 6.5 },
    Falklands: { cm: -57, fe: 147639.99999997593, fn: 5815417.000000032, magvar: -1.5 },
    GermanyCW: { cm: 21, fe: 35427.619999985734, fn: -6061633.128000011, magvar: 1.0 },
    Kola: { cm: 21, fe: -62702.00000000087, fn: -7543624.999999979, magvar: 14.0 },
    MarianaIslands: { cm: 147, fe: 238417.99999989968, fn: -1491840.000000048, magvar: -0.5 },
    MarianaIslandsWWII: { cm: 147, fe: 238417.99999989968, fn: -1491840.000000048, magvar: 1.5 },
    Nevada: { cm: -117, fe: -193996.80999964548, fn: -4410028.063999966, magvar: 11.5 },
    Normandy: { cm: -3, fe: -195526.00000000204, fn: -5484812.999999951, magvar: -8.0 },
    PersianGulf: { cm: 57, fe: 75755.99999999645, fn: -2894933.0000000377, magvar: 2.0 },
    SinaiMap: { cm: 33, fe: 169221.9999999585, fn: -3325312.9999999693, magvar: 5.0 },
    Syria: { cm: 39, fe: 282801.00000003993, fn: -3879865.9999999935, magvar: 5.5 },
    TheChannel: { cm: 3, fe: 99376.00000000288, fn: -5636889.00000001, magvar: -8.0 },
  };

  const A = 6378137.0;
  const F = 1 / 298.257223563;
  const E2 = F * (2 - F);
  const EP2 = E2 / (1 - E2);
  const K0 = 0.9996;
  const D2R = Math.PI / 180;
  const R2D = 180 / Math.PI;

  // Series de Krüger (precisión milimétrica incluso lejos del meridiano central).
  const N_ = F / (2 - F);
  const E_ = Math.sqrt(E2);
  const AR = A / (1 + N_) * (1 + N_ ** 2 / 4 + N_ ** 4 / 64);
  const ALPHA = [
    N_ / 2 - 2 * N_ ** 2 / 3 + 5 * N_ ** 3 / 16 + 41 * N_ ** 4 / 180,
    13 * N_ ** 2 / 48 - 3 * N_ ** 3 / 5 + 557 * N_ ** 4 / 1440,
    61 * N_ ** 3 / 240 - 103 * N_ ** 4 / 140,
    49561 * N_ ** 4 / 161280,
  ];
  const BETA = [
    N_ / 2 - 2 * N_ ** 2 / 3 + 37 * N_ ** 3 / 96 - N_ ** 4 / 360,
    N_ ** 2 / 48 + N_ ** 3 / 15 - 437 * N_ ** 4 / 1440,
    17 * N_ ** 3 / 480 - 37 * N_ ** 4 / 840,
    4397 * N_ ** 4 / 161280,
  ];
  const DELTA = [
    2 * N_ - 2 * N_ ** 2 / 3 - 2 * N_ ** 3 + 116 * N_ ** 4 / 45,
    7 * N_ ** 2 / 3 - 8 * N_ ** 3 / 5 - 227 * N_ ** 4 / 45,
    56 * N_ ** 3 / 15 - 136 * N_ ** 4 / 35,
    4279 * N_ ** 4 / 630,
  ];

  function tmForward(latDeg, lonDeg, cm, fe, fn, k0 = K0) {
    const phi = latDeg * D2R;
    const dl = (lonDeg - cm) * D2R;
    const t = Math.sinh(Math.atanh(Math.sin(phi)) - E_ * Math.atanh(E_ * Math.sin(phi)));
    const xi0 = Math.atan2(t, Math.cos(dl));
    const eta0 = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
    let xi = xi0, eta = eta0;
    for (let j = 1; j <= 4; j++) {
      xi += ALPHA[j - 1] * Math.sin(2 * j * xi0) * Math.cosh(2 * j * eta0);
      eta += ALPHA[j - 1] * Math.cos(2 * j * xi0) * Math.sinh(2 * j * eta0);
    }
    return { easting: fe + k0 * AR * eta, northing: fn + k0 * AR * xi };
  }

  function tmInverse(northing, easting, cm, fe, fn, k0 = K0) {
    const xi = (northing - fn) / (k0 * AR);
    const eta = (easting - fe) / (k0 * AR);
    let xi1 = xi, eta1 = eta;
    for (let j = 1; j <= 4; j++) {
      xi1 -= BETA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
      eta1 -= BETA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    }
    const chi = Math.asin(Math.sin(xi1) / Math.cosh(eta1));
    let phi = chi;
    for (let j = 1; j <= 4; j++) phi += DELTA[j - 1] * Math.sin(2 * j * chi);
    const lon = cm * D2R + Math.atan2(Math.sinh(eta1), Math.cos(xi1));
    return { lat: phi * R2D, lon: lon * R2D };
  }

  // Coordenadas de misión (x norte, y este) a lat/lon. null si el mapa no es conocido.
  function dcsToLL(theatre, x, y) {
    const p = THEATRES[theatre];
    if (!p) return null;
    return tmInverse(x, y, p.cm, p.fe, p.fn);
  }

  function llToDcs(theatre, lat, lon) {
    const p = THEATRES[theatre];
    if (!p) return null;
    const r = tmForward(lat, lon, p.cm, p.fe, p.fn);
    return { x: r.northing, y: r.easting };
  }

  // ---------- Distancias y rumbos ----------
  const R_EARTH = 6371008.8;
  const M_PER_NM = 1852;

  function distanceM(a, b) {
    const p1 = a.lat * D2R, p2 = b.lat * D2R;
    const dp = p2 - p1, dl = (b.lon - a.lon) * D2R;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  const distanceNm = (a, b) => distanceM(a, b) / M_PER_NM;

  function bearingDeg(a, b) {
    const p1 = a.lat * D2R, p2 = b.lat * D2R, dl = (b.lon - a.lon) * D2R;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * R2D + 360) % 360;
  }

  const norm360 = (d) => ((d % 360) + 360) % 360;
  const pad = (n, w) => String(n).padStart(w, '0');

  // ---------- Formatos ----------
  function splitDeg(value) {
    const a = Math.abs(value);
    return { deg: Math.floor(a), min: (a - Math.floor(a)) * 60 };
  }

  function fmtDD(v, isLat, prec = 5) {
    const h = isLat ? (v >= 0 ? 'N' : 'S') : (v >= 0 ? 'E' : 'W');
    return `${h} ${Math.abs(v).toFixed(prec)}°`;
  }

  function fmtDDM(v, isLat, prec = 3, lonWidth = 3) {
    const h = isLat ? (v >= 0 ? 'N' : 'S') : (v >= 0 ? 'E' : 'W');
    let { deg, min } = splitDeg(v);
    let m = Number(min.toFixed(prec));
    if (m >= 60) { deg += 1; m = 0; }
    const mw = prec > 0 ? 3 + prec : 2;
    return `${h} ${pad(deg, isLat ? 2 : lonWidth)}°${m.toFixed(prec).padStart(mw, '0')}'`;
  }

  function fmtDMS(v, isLat, prec = 1, lonWidth = 3) {
    const h = isLat ? (v >= 0 ? 'N' : 'S') : (v >= 0 ? 'E' : 'W');
    const a = Math.abs(v);
    let deg = Math.floor(a);
    let min = Math.floor((a - deg) * 60);
    let sec = Number((((a - deg) * 60 - min) * 60).toFixed(prec));
    if (sec >= 60) { sec = 0; min += 1; }
    if (min >= 60) { min = 0; deg += 1; }
    const sw = prec > 0 ? 3 + prec : 2;
    return `${h} ${pad(deg, isLat ? 2 : lonWidth)}°${pad(min, 2)}'${sec.toFixed(prec).padStart(sw, '0')}"`;
  }

  // ---------- UTM / MGRS ----------
  function utmZone(lat, lon) {
    let zone = Math.floor((lon + 180) / 6) + 1;
    if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;
    if (lat >= 72 && lat < 84) {
      if (lon >= 0 && lon < 9) zone = 31;
      else if (lon >= 9 && lon < 21) zone = 33;
      else if (lon >= 21 && lon < 33) zone = 35;
      else if (lon >= 33 && lon < 42) zone = 37;
    }
    return Math.min(60, Math.max(1, zone));
  }

  function toUTM(lat, lon) {
    const zone = utmZone(lat, lon);
    const cm = (zone - 1) * 6 - 180 + 3;
    const r = tmForward(lat, lon, cm, 500000, lat < 0 ? 10000000 : 0);
    return { zone, easting: r.easting, northing: r.northing, south: lat < 0 };
  }

  const BANDS = 'CDEFGHJKLMNPQRSTUVWX';
  const COL_SETS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
  const ROWS = 'ABCDEFGHJKLMNPQRSTUV';

  function toMGRS(lat, lon, digits = 5) {
    if (lat < -80 || lat > 84) return '—';
    const u = toUTM(lat, lon);
    const band = BANDS[Math.min(19, Math.floor((lat + 80) / 8))];
    const col = Math.floor(u.easting / 100000);
    const colLetter = COL_SETS[(u.zone - 1) % 3][col - 1];
    const rowIdx = Math.floor(u.northing / 100000) % 20;
    const rowLetter = ROWS[(rowIdx + (u.zone % 2 === 0 ? 5 : 0)) % 20];
    const div = Math.pow(10, 5 - digits);
    const e = pad(Math.floor((u.easting % 100000) / div), digits);
    const n = pad(Math.floor((u.northing % 100000) / div), digits);
    return `${u.zone}${band} ${colLetter}${rowLetter} ${e} ${n}`;
  }

  // Formatos preferidos por avión (precisión de la entrada de datos en cabina).
  function aircraftFormats(type = '') {
    if (type === 'FA-18C_hornet') return { DMS: { prec: 2 }, DDM: { prec: 4 }, MGRS: true };
    if (type.startsWith('A-10C') || type === 'AV-8B') return { DDM: { prec: 3 }, MGRS: true };
    if (type.startsWith('F-14')) return { DDM: { prec: 1 } };
    if (type === 'F-15ESE') return { DDM: { prec: 3 }, MGRS: true };
    if (type === 'F-16C_50') return { DDM: { prec: 3 }, MGRS: true };
    if (type === 'M-2000C') return { DDM: { prec: 1 } };
    if (type.startsWith('AH-64')) return { DDM: { prec: 2 }, MGRS: true };
    if (type.startsWith('Ka-50')) return { DDM: { prec: 1 } };
    if (type === 'F-4E-45MC') return { DDM: { prec: 1 }, MGRS: true };
    if (type.startsWith('C-130J') || type === 'Hercules') return { DDM: { prec: 3 } };
    return { DMS: { prec: 1 }, DDM: { prec: 3 }, MGRS: true };
  }

  function formatPoint(p, type) {
    const f = aircraftFormats(type);
    const out = [];
    if (f.DDM) out.push({ k: 'DDM', v: `${fmtDDM(p.lat, true, f.DDM.prec)}  ${fmtDDM(p.lon, false, f.DDM.prec)}` });
    if (f.DMS) out.push({ k: 'DMS', v: `${fmtDMS(p.lat, true, f.DMS.prec)}  ${fmtDMS(p.lon, false, f.DMS.prec)}` });
    if (f.MGRS) out.push({ k: 'MGRS', v: p.mgrs || toMGRS(p.lat, p.lon) });
    out.push({ k: 'DD', v: `${fmtDD(p.lat, true)}  ${fmtDD(p.lon, false)}` });
    if (p.alt != null && Number.isFinite(p.alt)) out.push({ k: 'ELEV', v: `${Math.round(p.alt * 3.28084)} ft  (${Math.round(p.alt)} m)` });
    return out;
  }

  // Lee coordenadas escritas a mano: "36.236 -115.034", "N36°14.23' W115°02.10'", "N 36 14 13.8 W 115 02 06"...
  function parseLatLon(text) {
    const s = String(text || '').toUpperCase().replace(/,/g, ' ').replace(/[°º'’′"”″]/g, ' ').replace(/([NSEWO])/g, ' $1 ').trim();
    const tokens = s.split(/\s+/).filter(Boolean);
    const groups = [];
    let cur = null;
    for (const t of tokens) {
      if (/^[NSEWO]$/.test(t)) {
        if (cur && cur.nums.length && !cur.hem) { cur.hem = t; groups.push(cur); cur = null; continue; }
        if (cur && cur.nums.length) groups.push(cur);
        cur = { hem: t, nums: [] };
      } else if (/^-?\d+(\.\d+)?$/.test(t)) {
        if (!cur) cur = { hem: null, nums: [] };
        cur.nums.push(Number(t));
      } else return null;
    }
    if (cur && cur.nums.length) groups.push(cur);
    let parts = groups;
    if (groups.length === 1 && !groups[0].hem) {
      const n = groups[0].nums;
      if (n.length % 2) return null;
      parts = [{ nums: n.slice(0, n.length / 2) }, { nums: n.slice(n.length / 2) }];
    }
    if (parts.length !== 2) return null;
    const val = (g) => {
      const [d, m = 0, sec = 0] = g.nums;
      let v = Math.abs(d) + m / 60 + sec / 3600;
      if (d < 0 || g.hem === 'S' || g.hem === 'W' || g.hem === 'O') v = -v;
      return v;
    };
    let lat = val(parts[0]), lon = val(parts[1]);
    if (/[EWO]/.test(parts[0].hem || '') && /[NS]/.test(parts[1].hem || '')) [lat, lon] = [lon, lat];
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon };
  }

  return {
    parseLatLon,
    THEATRES, dcsToLL, llToDcs, tmInverse, tmForward,
    distanceM, distanceNm, bearingDeg, norm360, M_PER_NM,
    fmtDD, fmtDDM, fmtDMS, toUTM, toMGRS, aircraftFormats, formatPoint,
  };
});
