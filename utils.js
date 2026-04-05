function parseFITSImage(arrayBuffer, dataView) {

    console.time("parseFITSImage");

    // Very basic FITS header parsing
    let headerText = "";
    let offset = 0;
    const headerSize = 2880;
    while (true) {
        const block = new TextDecoder().decode(
            arrayBuffer.slice(offset, offset + headerSize)
        );
        headerText += block;
        offset += headerSize;
        if (block.trim().endsWith("END")) break;
    }

    // Parse Header Keywords
    const headerLines = headerText.match(/.{1,80}/g); // Split into 80-char lines
    const header = {};
    for (const line of headerLines) {
        const keyword = line.substring(0, 8).trim();
        const value = line.substring(10, 80).trim();
        if (keyword === "END") break;
        header[keyword] = value;
    }
    console.timeLog("parseFITSImage", "parseFITSHeader");

    const width = parseInt(header["NAXIS1"], 10);
    const height = parseInt(header["NAXIS2"], 10);
    const bitpix = parseInt(header["BITPIX"], 10);
    const bscale = parseFloat(header["BSCALE"]) || 1;
    const bzero = parseFloat(header["BZERO"]) || 0;

    // Parse Image Data — using byte-swap + typed array for speed
    const dataSize = width * height;
    const bytesPerPixel = Math.abs(bitpix) / 8;
    const totalBytes = dataSize * bytesPerPixel;
    const src = new Uint8Array(arrayBuffer, offset, totalBytes);

    let data;
    if (bitpix === 8) {
        // 8-bit: no byte-swap needed
        data = new Int32Array(dataSize);
        for (let i = 0; i < dataSize; i++) {
            data[i] = src[i] * bscale + bzero;
        }
    } else if (bitpix === 16) {
        // 16-bit big-endian → swap bytes, read as Int16, store as Int32
        const buf = new ArrayBuffer(totalBytes);
        const dst = new Uint8Array(buf);
        for (let i = 0; i < totalBytes; i += 2) {
            dst[i] = src[i + 1];
            dst[i + 1] = src[i];
        }
        const raw = new Int16Array(buf);
        data = new Int32Array(dataSize);
        if (bscale === 1 && bzero === 0) {
            for (let i = 0; i < dataSize; i++) data[i] = raw[i];
        } else {
            for (let i = 0; i < dataSize; i++) data[i] = raw[i] * bscale + bzero;
        }
    } else if (bitpix === 32) {
        // 32-bit int big-endian → swap 4 bytes
        const buf = new ArrayBuffer(totalBytes);
        const dst = new Uint8Array(buf);
        for (let i = 0; i < totalBytes; i += 4) {
            dst[i] = src[i + 3];
            dst[i + 1] = src[i + 2];
            dst[i + 2] = src[i + 1];
            dst[i + 3] = src[i];
        }
        data = new Int32Array(buf);
        if (bscale !== 1 || bzero !== 0) {
            for (let i = 0; i < dataSize; i++) data[i] = data[i] * bscale + bzero;
        }
    } else if (bitpix === -32) {
        // 32-bit float big-endian → swap 4 bytes
        const buf = new ArrayBuffer(totalBytes);
        const dst = new Uint8Array(buf);
        for (let i = 0; i < totalBytes; i += 4) {
            dst[i] = src[i + 3];
            dst[i + 1] = src[i + 2];
            dst[i + 2] = src[i + 1];
            dst[i + 3] = src[i];
        }
        data = new Float32Array(buf);
        if (bscale !== 1 || bzero !== 0) {
            for (let i = 0; i < dataSize; i++) data[i] = data[i] * bscale + bzero;
        }
    } else if (bitpix === -64) {
        // 64-bit float big-endian → swap 8 bytes
        const buf = new ArrayBuffer(totalBytes);
        const dst = new Uint8Array(buf);
        for (let i = 0; i < totalBytes; i += 8) {
            dst[i] = src[i + 7];
            dst[i + 1] = src[i + 6];
            dst[i + 2] = src[i + 5];
            dst[i + 3] = src[i + 4];
            dst[i + 4] = src[i + 3];
            dst[i + 5] = src[i + 2];
            dst[i + 6] = src[i + 1];
            dst[i + 7] = src[i];
        }
        data = new Float64Array(buf);
        if (bscale !== 1 || bzero !== 0) {
            for (let i = 0; i < dataSize; i++) data[i] = data[i] * bscale + bzero;
        }
    } else {
        throw new Error(`Unsupported BITPIX: ${bitpix}`);
    }
    offset += totalBytes;
    console.timeLog("parseFITSImage", "parseFITSImageData");
    console.timeEnd("parseFITSImage");

    // console.log(header, normalizedData);
    return [header, width, height, data];
}

function normalizeData(data, vmin, vmax) {
    // Normalize Data for Display
    console.time("normalizeData");
    // const normalizedData = data.map(
    //     (value) => ((value - vmin) / (vmax - vmin)) * 255
    // );
    const scale = 255 / (vmax - vmin);
    const _offset = -vmin * scale;
    const normalizedData = new Float32Array(data.length);

    for (let i = 0; i < data.length; i++) {
        normalizedData[i] = data[i] * scale + _offset;
    }
    console.timeEnd("normalizeData");

    return normalizedData;
}

function zscale(
    values,
    histogram,
    autoZscale,
    n_samples = 1000,
    contrast = 0.25,
    max_reject = 0.5,
    min_npixels = 5,
    krej = 2.5,
    max_iterations = 5
) {
    console.time("zscale");

    if (!autoZscale) {
        const vmin = histogram.min;
        const vmax = histogram.max;
        console.timeEnd("zscale");
        return { vmin, vmax };
    }

    // Sample the image
    const stride = Math.max(1, Math.floor(values.length / n_samples));
    const samples = [];
    for (let i = 0; i < values.length && samples.length < n_samples; i += stride) {
        if (!isNaN(values[i])) samples.push(values[i]);
    }
    console.timeLog("zscale", "sampleImage");

    // Sort in-place to avoid extra memory usage
    samples.sort((a, b) => a - b);
    console.timeLog("zscale", "sortSamples");

    const npix = samples.length;
    let vmin = samples[0];
    let vmax = samples[npix - 1];

    // Precompute x values
    const x = new Array(npix);
    for (let i = 0; i < npix; i++) {
        x[i] = i;
    }
    console.timeLog("zscale", "precomputeX");

    let ngoodpix = npix;
    let last_ngoodpix = ngoodpix + 1;

    // Initialize bad pixels mask
    const badpix = new Array(npix).fill(false);

    const minpix = Math.max(min_npixels, Math.floor(npix * max_reject));
    let fit = { slope: 0, intercept: 0 };
    console.timeLog("zscale", "initializeBadPixelsMask");

    for (let iter = 0; iter < max_iterations; iter++) {
        if (ngoodpix >= last_ngoodpix || ngoodpix < minpix) break;

        fit = linearFit(x, samples, badpix);
        // Compute fitted values and residuals using loops
        const fitted = new Array(npix);
        const flat = new Array(npix);
        for (let i = 0; i < npix; i++) {
            fitted[i] = fit.slope * x[i] + fit.intercept;
            flat[i] = samples[i] - fitted[i];
        }

        // Compute threshold for k-sigma clipping
        const goodPixels = [];
        for (let i = 0; i < npix; i++) {
            if (!badpix[i]) goodPixels.push(flat[i]);
        }
        const sigma = std(goodPixels);
        const threshold = krej * sigma;

        // Update badpix mask
        ngoodpix = 0;
        for (let i = 0; i < npix; i++) {
            if (Math.abs(flat[i]) > threshold) {
                badpix[i] = true;
            } else {
                badpix[i] = false;
                ngoodpix++;
            }
        }

        last_ngoodpix = ngoodpix;
    }
    console.timeLog("zscale", "kSigmaClipping");

    if (ngoodpix >= minpix) {
        let slope = fit.slope;
        if (contrast > 0) {
            slope = slope / contrast;
        }
        const center_pixel = Math.floor((npix - 1) / 2);
        const median = medianValue(samples);
        vmin = Math.max(vmin, median - (center_pixel - 1) * slope);
        vmax = Math.min(vmax, median + (npix - center_pixel) * slope);
    }
    console.timeLog("zscale", "updateMinMax");
    console.timeEnd("zscale");

    return { vmin, vmax };
}

function linearFit(x, y, badpix) {
    // Optimized linear fit using loops
    let sumX = 0,
        sumY = 0,
        sumXY = 0,
        sumX2 = 0,
        n = 0;
    for (let i = 0; i < x.length; i++) {
        if (!badpix[i]) {
            const xi = x[i];
            const yi = y[i];
            sumX += xi;
            sumY += yi;
            sumXY += xi * yi;
            sumX2 += xi * xi;
            n++;
        }
    }
    const denominator = n * sumX2 - sumX * sumX;
    const slope = (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;
    return { slope, intercept };
}

function std(arr) {
    // Optimized standard deviation calculation
    let mean = 0;
    for (let i = 0; i < arr.length; i++) {
        mean += arr[i];
    }
    mean /= arr.length;
    let variance = 0;
    for (let i = 0; i < arr.length; i++) {
        const diff = arr[i] - mean;
        variance += diff * diff;
    }
    variance /= arr.length;
    return Math.sqrt(variance);
}

function medianValue(arr) {
    // Optimized median calculation using Quickselect algorithm
    const n = arr.length;
    const k = Math.floor(n / 2);
    return quickSelect(arr, k);
}

function quickSelect(arr, k) {
    // In-place Quickselect algorithm
    let left = 0;
    let right = arr.length - 1;
    while (left <= right) {
        const pivotIndex = partition(arr, left, right);
        if (pivotIndex === k) {
            return arr[k];
        } else if (pivotIndex < k) {
            left = pivotIndex + 1;
        } else {
            right = pivotIndex - 1;
        }
    }
}

function partition(arr, left, right) {
    const pivotValue = arr[right];
    let pivotIndex = left;
    for (let i = left; i < right; i++) {
        if (arr[i] < pivotValue) {
            [arr[i], arr[pivotIndex]] = [arr[pivotIndex], arr[i]];
            pivotIndex++;
        }
    }
    [arr[right], arr[pivotIndex]] = [arr[pivotIndex], arr[right]];
    return pivotIndex;
}

function convolve(arr, kernel) {
    // Optimized convolution using loops
    const result = new Array(arr.length).fill(false);
    const kernelLength = kernel.length;
    for (let i = 0; i < arr.length; i++) {
        if (arr[i]) {
            for (let j = 0; j < kernelLength; j++) {
                const idx = i + j;
                if (idx < arr.length) {
                    result[idx] = true;
                }
            }
        }
    }
    return result;
}

function formatNumber(num, precision) {
    if (Math.floor(num) === num) {
        return num; // return as is, when it's an integer
    } else {
        return num.toFixed(precision); // use toFixed when there are decimals
    }
}
