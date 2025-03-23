// Function to calculate the Full Width at Half Maximum (FWHM) of a star in an image
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
    const r1 = fwhm * 3 / 2;
    const r2 = fwhm * 4 / 2;
    const r3 = fwhm * 5 / 2;

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

// Function to extract a subarray around a point
function extractSubarray(image, centerX, centerY, size) {
    const halfSize = Math.floor(size / 2);
    const startX = Math.max(0, centerX - halfSize);
    const startY = Math.max(0, centerY - halfSize);
    const endX = Math.min(imageWidth - 1, centerX + halfSize);
    const endY = Math.min(imageHeight - 1, centerY + halfSize);

    const width = endX - startX + 1;
    const height = endY - startY + 1;

    const subarray = new Array(height);
    for (let y = 0; y < height; y++) {
        subarray[y] = new Array(width);
        for (let x = 0; x < width; x++) {
            subarray[y][x] = imageData[(startY + y) * imageWidth + (startX + x)];
        }
    }

    return {
        array: subarray,
        offsetX: startX,
        offsetY: startY
    };
}

// Function to calculate FWHM with automatic sizing
function calculateAdaptiveFWHM(x, y, _plateScale) {
    // Start with a reasonable box size
    let boxSize = 20;
    if (_plateScale === undefined) {
        _plateScale = 1.0;
    } else {
        // set box to 20" in pixels
        boxSize = Math.ceil(20 / _plateScale);
    }
    let fwhmResult = null;
    let iteration = 0;
    const MAX_ITERATIONS = 3;

    // Extract initial subarray
    let { array, offsetX, offsetY } = extractSubarray(imageData, x, y, boxSize);

    // Convert from 1D array to 2D array format expected by calculateStarFWHM
    let subarray2D = [];
    for (let row = 0; row < array.length; row++) {
        subarray2D.push(array[row]);
    }

    // Initial FWHM calculation
    fwhmResult = calculateStarFWHM(subarray2D);

    // Adaptive resizing - expand box if FWHM is large compared to box size
    while (iteration < MAX_ITERATIONS && fwhmResult.fwhm * 5 > boxSize) {
        boxSize = Math.min(Math.ceil(fwhmResult.fwhm * 10), Math.min(imageWidth, imageHeight) / 2);

        // Extract larger subarray
        let { array: newArray, offsetX: newOffsetX, offsetY: newOffsetY } =
            extractSubarray(imageData, x, y, boxSize);

        // Convert to 2D array
        subarray2D = [];
        for (let row = 0; row < newArray.length; row++) {
            subarray2D.push(newArray[row]);
        }

        // Recalculate FWHM with larger box
        fwhmResult = calculateStarFWHM(subarray2D, x - newOffsetX, y - newOffsetY);

        // Update offsets
        offsetX = newOffsetX;
        offsetY = newOffsetY;

        iteration++;
    }
    // console.log(`Iteration ${iteration}: FWHM = ${fwhmResult.fwhm}, Box size = ${boxSize}`);

    // Adjust center coordinates to global image coordinates
    fwhmResult.center.x += offsetX;
    fwhmResult.center.y += offsetY;

    return fwhmResult;
}

// Function to draw aperture circles based on FWHM
function drawApertureCircles(fwhmResult, scale) {

    // Draw the three aperture circles
    const { center, radii } = fwhmResult;
    ctx.lineWidth = scale;    // Keep line width constant

    // FWHM circle
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';  // Green with transparency
    ctx.beginPath();
    ctx.arc(center.x, center.y, fwhmResult.fwhm / 2, 0, Math.PI * 2);
    ctx.stroke();

    // Outer aperture (background)
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)';  // Red with transparency
    ctx.beginPath();
    ctx.arc(center.x, center.y, radii.r3, 0, Math.PI * 2);
    ctx.stroke();
}