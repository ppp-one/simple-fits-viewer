// Archive images of the field being viewed:
//   - single dated photographic plates from the STScI Digitized Sky Survey (DSS)
//   - historical plates from Harvard DASCH (1880s-1990s)
//   - modern sky surveys from CDS HiPS (the surveys Aladin and SIMBAD show), cut out by hips2fits
// Every source returns a FITS image with a TAN WCS. reproject() resamples it onto
// the pixel grid of the open image, so the two can be blinked or blended.
import { parseFITSImage, splitHeaderValue } from './utils.js';
import { WCS } from './wcs.js';

const DSS_URL = 'https://archive.stsci.edu/cgi-bin/dss_search';
const DASCH_URL = 'https://api.starglass.cfa.harvard.edu/public/dasch/dr7';
const HIPS2FITS_URL = 'https://alasky.cds.unistra.fr/hips-image-services/hips2fits';
const MOCSERVER_URL = 'https://alasky.cds.unistra.fr/MocServer/query';

const DSS_MAX_ARCMIN = 60;   // largest cutout the STScI server returns
// hips2fits cutout side limit. Server time grows fast with size (measured: 1136 px
// about 3 s, 2000 px about 45 s), so larger fields get a coarser cutout.
const HIPS_MAX_PX = 1500;
const FIELD_MARGIN = 1.05;   // cutout side relative to the field diameter
const MESH = 16;             // reproject(): grid cells between exact WCS evaluations

export const DSS_SURVEYS = [
    { id: 'poss1_red', label: 'POSS-I red (1950s)' },
    { id: 'poss1_blue', label: 'POSS-I blue (1950s)' },
    { id: 'poss2ukstu_red', label: 'POSS-II / UKST red' },
    { id: 'poss2ukstu_blue', label: 'POSS-II / UKST blue' },
    { id: 'poss2ukstu_ir', label: 'POSS-II / UKST IR' },
];

// Single-band HiPS. Colour HiPS have no FITS tiles, so they cannot be cut out as data.
export const HIPS_SURVEYS = [
    { id: 'CDS/P/DSS2/blue', label: 'DSS2 blue' },
    { id: 'CDS/P/DSS2/red', label: 'DSS2 red' },
    { id: 'CDS/P/DSS2/NIR', label: 'DSS2 NIR' },
    { id: 'CDS/P/2MASS/J', label: '2MASS J' },
    { id: 'CDS/P/2MASS/K', label: '2MASS K' },
    { id: 'CDS/P/SDSS9/g', label: 'SDSS g' },
    { id: 'CDS/P/SDSS9/r', label: 'SDSS r' },
    { id: 'CDS/P/PanSTARRS/DR1/g', label: 'Pan-STARRS g' },
    { id: 'CDS/P/PanSTARRS/DR1/r', label: 'Pan-STARRS r' },
    { id: 'CDS/P/PanSTARRS/DR1/i', label: 'Pan-STARRS i' },
    { id: 'CDS/P/DESI-Legacy-Surveys/DR10/r', label: 'DESI Legacy Surveys r' },
    { id: 'CDS/P/ZTF/DR7/g', label: 'ZTF g' },
    { id: 'CDS/P/ZTF/DR7/r', label: 'ZTF r' },
    { id: 'CDS/P/GALEXGR6_7/NUV', label: 'GALEX NUV' },
    { id: 'CDS/P/allWISE/W1', label: 'AllWISE W1' },
];

// ── Field geometry ────────────────────────────────────────────────────────────

function angularDistance(ra1, dec1, ra2, dec2) {
    const d2r = Math.PI / 180;
    const s = Math.sin((dec2 - dec1) * d2r / 2) ** 2 +
        Math.cos(dec1 * d2r) * Math.cos(dec2 * d2r) * Math.sin((ra2 - ra1) * d2r / 2) ** 2;
    return 2 * Math.asin(Math.min(1, Math.sqrt(s))) / d2r;
}

// Centre of the image and the radius (deg) of the circle through its farthest corner.
// FITS pixel coordinates: the image covers [0.5, width + 0.5] x [0.5, height + 0.5].
export function fieldOfView(wcs, width, height) {
    const [ra, dec] = wcs.sipPixelxy2radec((width + 1) / 2, (height + 1) / 2);
    let radius = 0;
    for (const [x, y] of [[0.5, 0.5], [width + 0.5, 0.5], [0.5, height + 0.5], [width + 0.5, height + 0.5]]) {
        const [r, d] = wcs.sipPixelxy2radec(x, y);
        radius = Math.max(radius, angularDistance(ra, dec, r, d));
    }
    return { ra, dec, radius };
}

export function mjdToYear(mjd) {
    return new Date((mjd - 40587) * 86400000).getUTCFullYear();
}

export function aladinUrl(ra, dec, fovDeg, survey = 'CDS/P/DSS2/color') {
    const params = new URLSearchParams({ target: `${ra.toFixed(6)} ${dec.toFixed(6)}`, fov: fovDeg.toFixed(4), survey });
    return `https://aladin.cds.unistra.fr/AladinLite/?${params.toString()}`;
}

// ── Fetching ──────────────────────────────────────────────────────────────────

// Parse a FITS cutout into {data, width, height, wcs, header}. Integer BLANK
// pixels (no data) become NaN.
export function parseCutout(arrayBuffer) {
    const [header, width, height, rawData] = parseFITSImage(arrayBuffer, new DataView(arrayBuffer));
    const data = rawData instanceof Float32Array || rawData instanceof Float64Array ? rawData : Float32Array.from(rawData);
    if (header['BLANK'] !== undefined) {
        const bscale = parseFloat(header['BSCALE']) || 1;
        const bzero = parseFloat(header['BZERO']) || 0;
        const blank = parseFloat(header['BLANK']) * bscale + bzero;
        for (let i = 0; i < data.length; i++) if (data[i] === blank) data[i] = NaN;
    }
    return { data, width, height, wcs: new WCS(header), header };
}

export function headerString(header, key) {
    return header[key] === undefined ? '' : splitHeaderValue(header[key]).value.trim();
}

// Archive servers can take many seconds, so every request is logged with its time
// (in VS Code the console goes to the "Simple FITS Viewer" output channel)
function logRequest(sourceName, url, t0, outcome) {
    const seconds = ((performance.now() - t0) / 1000).toFixed(1);
    const shortUrl = url.length > 160 ? `${url.slice(0, 160)}...` : url;
    console.log(`Archive: ${sourceName}: ${outcome} in ${seconds} s (${shortUrl})`);
}

function formatBytes(n) {
    return n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} kB`;
}

async function fetchFits(url, init, sourceName) {
    const t0 = performance.now();
    let res;
    try {
        res = await fetch(url, init);
    } catch (err) {
        if (err.name === 'AbortError') throw err;
        logRequest(sourceName, url, t0, `failed (${err.message})`);
        throw new Error(`Could not reach ${sourceName}`);
    }
    // STScI answers "no plate here" with HTTP 200 and an HTML page
    const type = res.headers.get('content-type') || '';
    if (!res.ok || type.includes('html')) {
        const text = await res.text().catch(() => '');
        logRequest(sourceName, url, t0, `HTTP ${res.status} ${type}`);
        if (type.includes('html')) throw new Error(`${sourceName} has no image of this field`);
        throw new Error(`${sourceName}: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    const buffer = await res.arrayBuffer();
    logRequest(sourceName, url, t0, formatBytes(buffer.byteLength));
    return buffer;
}

// One DSS plate: the server picks the plate nearest the field centre.
export async function fetchDss(survey, field, signal) {
    const side = Math.min(DSS_MAX_ARCMIN, 2 * field.radius * 60 * FIELD_MARGIN);
    const params = new URLSearchParams({
        v: survey, r: field.ra.toFixed(6), d: field.dec.toFixed(6), e: 'J2000',
        h: side.toFixed(2), w: side.toFixed(2), f: 'fits', c: 'none',
    });
    const buffer = await fetchFits(`${DSS_URL}?${params}`, { signal }, 'STScI DSS');
    return { cutout: parseCutout(buffer), clipped: 2 * field.radius * 60 * FIELD_MARGIN > DSS_MAX_ARCMIN };
}

// `pixelScale`: wanted arcsec per pixel (the server resamples the HiPS to it).
// A scale finer than the survey's own (see queryHipsCoverage) only costs server time.
export async function fetchHips(hipsId, field, pixelScale, signal) {
    const fov = 2 * field.radius * FIELD_MARGIN;
    const size = Math.max(16, Math.min(HIPS_MAX_PX, Math.ceil(fov * 3600 / pixelScale)));
    const params = new URLSearchParams({
        hips: hipsId, width: size, height: size, fov: fov.toFixed(6), projection: 'TAN',
        coordsys: 'icrs', ra: field.ra.toFixed(6), dec: field.dec.toFixed(6), format: 'fits',
    });
    const buffer = await fetchFits(`${HIPS2FITS_URL}?${params}`, { signal }, 'CDS hips2fits');
    return parseCutout(buffer);
}

// Which of `ids` cover the field, with their epoch range and resolution:
// Map id -> {tMin, tMax, pixelScale}. tMin/tMax are MJD, pixelScale is the
// survey's own pixel size in arcsec; each is null when unknown.
export async function queryHipsCoverage(ids, field, signal) {
    const params = new URLSearchParams({
        RA: field.ra.toFixed(6), DEC: field.dec.toFixed(6), SR: field.radius.toFixed(6),
        intersect: 'overlaps', expr: ids.map(id => `ID=${id}`).join('||'),
        fields: 'ID,t_min,t_max,hips_pixel_scale', fmt: 'json',
    });
    const url = `${MOCSERVER_URL}?${params}`;
    const t0 = performance.now();
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`MocServer: HTTP ${res.status}`);
    const toMjd = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
    const rows = await res.json();
    logRequest('CDS MocServer', url, t0, `${rows.length} of ${ids.length} surveys cover the field`);
    return new Map(rows.map(r => [r.ID, {
        tMin: toMjd(r.t_min),
        tMax: toMjd(r.t_max),
        pixelScale: Number(r.hips_pixel_scale) * 3600 || null, // degrees in the record
    }]));
}

// DASCH sends no CORS headers on its responses, so a web page cannot read them.
// `fetchFn` must be a fetch-compatible function that is not limited by CORS
// (in VS Code the extension host runs the request, see proxy-fetch.js).
async function postDasch(endpoint, body, signal, fetchFn) {
    // The DASCH gateway sometimes times out (HTTP 504) on a request that succeeds
    // when sent again, so a gateway error gets one retry
    const url = `${DASCH_URL}/${endpoint}`;
    for (let attempt = 0; ; attempt++) {
        const t0 = performance.now();
        let res;
        try {
            res = await fetchFn(url, {
                method: 'POST', signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        } catch (err) {
            if (err.name === 'AbortError') throw err;
            logRequest('DASCH', url, t0, `failed (${err.message})`);
            throw new Error('Could not reach DASCH');
        }
        const gatewayError = res.status >= 502 && res.status <= 504;
        if (gatewayError) logRequest('DASCH', url, t0, `HTTP ${res.status}${attempt === 0 ? ', retrying' : ''}`);
        if (gatewayError && attempt === 0) continue;
        const text = await res.text().catch(() => '');
        if (!gatewayError && !signal?.aborted) logRequest('DASCH', url, t0, `HTTP ${res.status}, ${formatBytes(text.length)}`);
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON: error text below */ }
        if (gatewayError) throw new Error(`DASCH did not answer (HTTP ${res.status}). Try again later.`);
        if (!res.ok) throw new Error(`DASCH: ${json?.error || `HTTP ${res.status}`}`);
        return json;
    }
}

// Scanned DASCH plates with an astrometric solution that cover (ra, dec), oldest first:
// [{id, solution, date, exptime, limMag}]. limMag (mag) is null for uncalibrated plates.
// The search takes 15-20 s on the server, so results are kept per position (~0.4")
const daschPlateCache = new Map();

export async function queryDaschPlates(ra, dec, signal, fetchFn) {
    const key = `${ra.toFixed(4)},${dec.toFixed(4)}`;
    if (daschPlateCache.has(key)) return daschPlateCache.get(key);
    const rows = await postDasch('queryexps', { ra_deg: ra, dec_deg: dec }, signal, fetchFn);
    if (signal?.aborted) return [];
    if (!Array.isArray(rows) || rows.length < 2) return [];
    const cols = rows[0].split(',');
    const col = (name) => cols.indexOf(name);
    const iSeries = col('series'), iNum = col('platenum'), iMos = col('mosnum'), iSol = col('solnum');
    const iWcs = col('wcssource'), iDate = col('expdate'), iExp = col('exptime');
    const iApass = col('limMagApass'), iAtlas = col('limMagAtlas');

    const plates = new Map();
    for (const line of rows.slice(1)) {
        const f = line.split(',');
        if (f[iWcs] !== 'imwcs' || Number(f[iMos]) < 0 || Number(f[iSol]) < 0) continue;
        const id = `${f[iSeries]}${f[iNum].padStart(5, '0')}`;
        const solution = Number(f[iSol]);
        const key = `${id}/${solution}`;
        if (plates.has(key)) continue; // one entry per plate, not per exposure
        const limMag = parseFloat(f[iApass]) || parseFloat(f[iAtlas]) || null;
        plates.set(key, { id, solution, date: f[iDate], exptime: parseFloat(f[iExp]), limMag });
    }
    const sorted = [...plates.values()].sort((a, b) => a.date.localeCompare(b.date));
    daschPlateCache.set(key, sorted);
    return sorted;
}

// The cutout comes back as a JSON string: a base64 gzipped FITS file
export async function fetchDaschCutout(plate, field, signal, fetchFn) {
    const b64 = await postDasch('cutout', {
        plate_id: plate.id, solution_number: plate.solution,
        center_ra_deg: field.ra, center_dec_deg: field.dec,
    }, signal, fetchFn);
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return parseCutout(await new Response(stream).arrayBuffer());
}

// ── Reprojection ──────────────────────────────────────────────────────────────

// Resample `src` ({data, width, height, wcs}) onto the pixel grid of an image with
// WCS `dstWcs` and size dstWidth x dstHeight, binned by `step` (each output cell
// covers step x step image pixels). Returns {data, width, height} with cell (0, 0)
// at image pixel (0, 0); cells outside the source are NaN.
// The WCS mapping is smooth, so it is computed exactly every MESH cells and
// interpolated between; the source is sampled bilinearly.
export function reproject(src, dstWcs, dstWidth, dstHeight, step) {
    const gw = Math.ceil(dstWidth / step);
    const gh = Math.ceil(dstHeight / step);
    const mw = Math.max(2, Math.ceil((gw - 1) / MESH) + 1);
    const mh = Math.max(2, Math.ceil((gh - 1) / MESH) + 1);

    // Source pixel position (0-based, pixel centres at integers) of mesh nodes
    const meshX = new Float64Array(mw * mh);
    const meshY = new Float64Array(mw * mh);
    for (let j = 0; j < mh; j++) {
        for (let i = 0; i < mw; i++) {
            // Cell centre in FITS pixel coordinates of the destination image
            const px = (i * MESH + 0.5) * step + 0.5;
            const py = (j * MESH + 0.5) * step + 0.5;
            const radec = dstWcs.sipPixelxy2radec(px, py);
            const xy = radec && src.wcs.sipRadec2Pixelxy(radec[0], radec[1]);
            meshX[j * mw + i] = xy ? xy[0] - 1 : NaN;
            meshY[j * mw + i] = xy ? xy[1] - 1 : NaN;
        }
    }

    const { data, width: sw, height: sh } = src;
    const out = new Float32Array(gw * gh).fill(NaN);
    for (let gy = 0; gy < gh; gy++) {
        const mj = Math.min(mh - 2, Math.floor(gy / MESH));
        const fy = gy / MESH - mj;
        for (let gx = 0; gx < gw; gx++) {
            const mi = Math.min(mw - 2, Math.floor(gx / MESH));
            const fx = gx / MESH - mi;
            const k = mj * mw + mi;
            const sx = (1 - fy) * ((1 - fx) * meshX[k] + fx * meshX[k + 1]) + fy * ((1 - fx) * meshX[k + mw] + fx * meshX[k + mw + 1]);
            const sy = (1 - fy) * ((1 - fx) * meshY[k] + fx * meshY[k + 1]) + fy * ((1 - fx) * meshY[k + mw] + fx * meshY[k + mw + 1]);
            // NaN fails these tests too
            if (!(sx >= -0.5 && sx <= sw - 0.5 && sy >= -0.5 && sy <= sh - 0.5)) continue;

            const x0 = Math.min(sw - 2, Math.max(0, Math.floor(sx)));
            const y0 = Math.min(sh - 2, Math.max(0, Math.floor(sy)));
            const tx = Math.min(1, Math.max(0, sx - x0));
            const ty = Math.min(1, Math.max(0, sy - y0));
            const p = y0 * sw + x0;
            out[gy * gw + gx] =
                (1 - ty) * ((1 - tx) * data[p] + tx * data[p + 1]) +
                ty * ((1 - tx) * data[p + sw] + tx * data[p + sw + 1]);
        }
    }
    return { data: out, width: gw, height: gh };
}
