/**
 * Calculates the FWHM (Full Width at Half Maximum) of a star in an image
 * @param {number[][]} image - 2D array representing the star image
 * @param {number} [centerX] - X coordinate of star center (optional, will find brightest pixel if not specified)
 * @param {number} [centerY] - Y coordinate of star center (optional, will find brightest pixel if not specified)
 * @returns {Object} Object containing FWHM and related measurements
 */
function calculateStarFWHM(image, centerX, centerY) {
    // Find the dimensions of the image
    const height = image.length;
    const width = image[0].length;

    // Find the peak intensity and center if not provided
    let peak = 0;
    if (centerX === undefined || centerY === undefined) {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (image[y][x] > peak) {
                    peak = image[y][x];
                    centerX = x;
                    centerY = y;
                }
            }
        }
    } else {
        peak = image[Math.round(centerY)][Math.round(centerX)];
    }

    // Calculate the background (using corners of the image)
    let background = 0;
    let backgroundCount = 0;

    const borderSize = Math.max(5, Math.floor(Math.min(width, height) * 0.1));

    // Top and bottom borders
    for (let y = 0; y < borderSize; y++) {
        for (let x = 0; x < width; x++) {
            background += image[y][x];
            backgroundCount++;
        }
        for (let x = 0; x < width; x++) {
            background += image[height - 1 - y][x];
            backgroundCount++;
        }
    }

    // Left and right borders (excluding corners counted above)
    for (let y = borderSize; y < height - borderSize; y++) {
        for (let x = 0; x < borderSize; x++) {
            background += image[y][x];
            backgroundCount++;
        }
        for (let x = 0; x < borderSize; x++) {
            background += image[y][width - 1 - x];
            backgroundCount++;
        }
    }

    background = background / backgroundCount;

    // Determine the radius to analyze (distance to edge from center)
    const maxRadius = Math.min(
        Math.min(centerX, width - 1 - centerX),
        Math.min(centerY, height - 1 - centerY)
    );

    // We'll use this radius for our analysis, but capped at a reasonable value
    const analysisRadius = Math.min(maxRadius, 30);
    const nBins = Math.ceil(analysisRadius); // Number of bins = radius

    // Initialize arrays for radial analysis
    const radii = new Array(nBins).fill(0);   // Average radius of each bin
    const means = new Array(nBins).fill(0);   // Average intensity of each bin
    const counts = new Array(nBins).fill(0);  // Number of pixels in each bin

    // Accumulate pixel values in radial bins
    const xMin = Math.max(0, Math.floor(centerX - analysisRadius));
    const xMax = Math.min(width - 1, Math.ceil(centerX + analysisRadius));
    const yMin = Math.max(0, Math.floor(centerY - analysisRadius));
    const yMax = Math.min(height - 1, Math.ceil(centerY + analysisRadius));

    for (let y = yMin; y <= yMax; y++) {
        const dy = y + 0.5 - centerY;  // +0.5 for pixel center
        for (let x = xMin; x <= xMax; x++) {
            const dx = x + 0.5 - centerX;  // +0.5 for pixel center
            const r = Math.sqrt(dx * dx + dy * dy);
            const bin = Math.floor(r);

            if (bin < nBins) {
                const pixelValue = image[y][x];
                radii[bin] += r;
                means[bin] += pixelValue;
                counts[bin]++;
            }
        }
    }

    // Calculate the average intensity at each radius
    let meanPeak = 0;
    for (let bin = 0; bin < nBins; bin++) {
        if (counts[bin] > 0) {
            means[bin] = means[bin] / counts[bin];
            radii[bin] = radii[bin] / counts[bin];

            if (means[bin] > meanPeak) {
                meanPeak = means[bin];
            }
        } else {
            means[bin] = NaN;
            radii[bin] = NaN;
        }
    }

    // Normalize intensities (subtract background and divide by peak)
    const normalizedMeans = means.map(value =>
        isNaN(value) ? NaN : (value - background) / (meanPeak - background)
    );

    // Find FWHM by locating where the normalized intensity crosses 0.5
    let fwhm = 0;
    let foundFWHM = false;

    for (let bin = 1; bin < nBins; bin++) {
        if (!foundFWHM &&
            !isNaN(normalizedMeans[bin - 1]) && !isNaN(normalizedMeans[bin]) &&
            normalizedMeans[bin - 1] > 0.5 && normalizedMeans[bin] <= 0.5) {

            // Linear interpolation to find the exact radius where intensity = 0.5
            const m = (normalizedMeans[bin] - normalizedMeans[bin - 1]) / (radii[bin] - radii[bin - 1]);
            fwhm = 2.0 * (radii[bin - 1] + (0.5 - normalizedMeans[bin - 1]) / m);
            foundFWHM = true;
        }
    }

    // Calculate the appropriate aperture radii based on FWHM
    // These values are derived from the SEEING_RADIUS constants in the Java code
    const r1 = fwhm * 1.7;
    const r2 = fwhm * 1.9;
    const r3 = fwhm * 2.55;

    return {
        center: { x: centerX, y: centerY },
        peak: peak,
        background: background,
        fwhm: fwhm,
        hwhm: fwhm / 2,  // Half Width at Half Maximum
        radii: { r1, r2, r3 }, // Aperture radii
        radialProfile: {
            radius: radii.filter(r => !isNaN(r)),
            intensity: means.filter(m => !isNaN(m)),
            normalizedIntensity: normalizedMeans.filter(m => !isNaN(m))
        }
    };
}

/**
 * Example usage:
 * 
 * // Create a test star image (Gaussian distribution)
 function createTestStarImage(width, height, centerX, centerY, amplitude, sigma, background) {
     const image = [];
     for (let y = 0; y < height; y++) {
         const row = [];
         for (let x = 0; x < width; x++) {
             const dx = x - centerX;
             const dy = y - centerY;
             const r2 = dx*dx + dy*dy;
              row.push(amplitude * Math.exp(-r2/(2*sigma*sigma)) + background);
         }
         image.push(row);
     }
     return image;
 }
 
 // Create a test image (50x50 pixels with a star at center)
 const testImage = createTestStarImage(50, 50, 25, 25, 100, 3, 10);
 
 // Calculate FWHM
 const result = calculateStarFWHM(testImage);
 console.log(`FWHM: ${result.fwhm.toFixed(2)} pixels`);
 console.log(`Suggested aperture radius: ${result.radii.r1.toFixed(2)} pixels`);
 */

function createTestStarImage(width, height, centerX, centerY, amplitude, sigma, background) {
    const image = [];
    for (let y = 0; y < height; y++) {
        const row = [];
        for (let x = 0; x < width; x++) {
            const dx = x - centerX;
            const dy = y - centerY;
            const r2 = dx * dx + dy * dy;
            row.push(amplitude * Math.exp(-r2 / (2 * sigma * sigma)) + background);
        }
        image.push(row);
    }
    return image;
}

// // Create a test image (50x50 pixels with a star at center)
// const testImage = createTestStarImage(250, 150, 70, 40, 10, 20 / 2.355, 100);

// // Calculate FWHM
// const result = calculateStarFWHM(testImage);
// console.log(`FWHM: ${result.fwhm.toFixed(2)} pixels`);
// console.log(`Suggested aperture radius: ${result.radii.r1.toFixed(2)} pixels`);