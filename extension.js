const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function activate(context) {
	console.log("Extension 'simple-fits-viewer' is now active!");
	const startTime = Date.now();
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider('fitFileViewer', new FITSFileEditor(context))
    );
	const endTime = Date.now();
	console.log(`Activation took ${endTime - startTime} ms`);
}

class FITSFileEditor {
	constructor(context) {
        this.context = context;
    }
	
    async resolveCustomTextEditor(document, webviewPanel, token) {
		const startTime0 = Date.now();
        // Set up the webview content
        webviewPanel.webview.options = {
            enableScripts: true
        };

        // Function to update webview content
        const updateWebview = () => {
            try {
				const startTime = Date.now();

				// Step 1: Read the FITS file as an ArrayBuffer
				const readStartTime = Date.now();
				const arrayBuffer = fs.readFileSync(document.uri.fsPath).buffer;
				const readEndTime = Date.now();
				console.log(`Reading FITS file took ${readEndTime - readStartTime} ms`);

				// Step 2: Create DataView for parsing
				const dataView = new DataView(arrayBuffer);

				// Step 3: Parse the FITS header and data
				const parseStartTime = Date.now();
				const [headerInfo, normalizedData, width, height, rawData] = this.parseFITSHeader(arrayBuffer, dataView);
				const parseEndTime = Date.now();
				console.log(`Parsing FITS file took ${parseEndTime - parseStartTime} ms`);

				// Step 4: Update the webview content
				const updateStartTime = Date.now();
				webviewPanel.webview.html = this.getWebviewContent(headerInfo, width, height);
				const updateEndTime = Date.now();
				console.log(`Updating webview content took ${updateEndTime - updateStartTime} ms`);

				const endTime = Date.now();
				console.log(`Total FITS file processing took ${endTime - startTime} ms`);

                webviewPanel.webview.onDidReceiveMessage(
                    message => {
                        if (message.command === 'ready') {
							console.log('Webview is ready');
                            webviewPanel.webview.postMessage({
                                command: 'loadData',
                                data: normalizedData,
                                width: width,
                                height: height,
								originalData: rawData
                            });
                        }
                    },
                    undefined,
                    this.context.subscriptions
                );
            } catch (error) {
				console.log(error);
                vscode.window.showErrorMessage(`Error reading FITS file: ${error.message}`);
            }
        };

        // Initial update
        updateWebview();

        // Handle document changes
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.uri.toString() === document.uri.toString()) {
                updateWebview();
            }
        });

        // Clean up subscription when panel is disposed
        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });
		const endTime0 = Date.now();
		console.log(`resolveCustomTextEditor took ${endTime0 - startTime0} ms`);
    }

    parseFITSHeader(arrayBuffer, dataView) {

        // Very basic FITS header parsing
        let headerText = '';
        let offset = 0;
        const headerSize = 2880;
        while (true) {
          const block = new TextDecoder().decode(arrayBuffer.slice(offset, offset + headerSize));
          headerText += block;
          offset += headerSize;
          if (block.includes('END')) break;
        }

		// Parse Header Keywords
        const headerLines = headerText.match(/.{1,80}/g); // Split into 80-char lines
        const header = {};
        for (const line of headerLines) {
          const keyword = line.substring(0, 8).trim();
          const value = line.substring(10, 80).trim();
          if (keyword === 'END') break;
          header[keyword] = value;
        }

		const width = parseInt(header['NAXIS1'], 10);
        const height = parseInt(header['NAXIS2'], 10);
        const bitpix = parseInt(header['BITPIX'], 10);
        const bscale = parseFloat(header['BSCALE']) || 1;
        const bzero = parseFloat(header['BZERO']) || 0;

		// Parse Image Data
        const dataSize = width * height;
        const bytesPerPixel = Math.abs(bitpix) / 8;
        const data = [];

        for (let i = 0; i < dataSize; i++) {
          let pixelValue;

          if (bitpix === 16) {
            pixelValue = dataView.getInt16(offset, false); // 16-bit signed integer
          } else if (bitpix === 32) {
            pixelValue = dataView.getInt32(offset, false); // 32-bit signed integer
          } else if (bitpix === -32) {
            pixelValue = dataView.getFloat32(offset, false); // 32-bit float
          } else if (bitpix === -64) {
            pixelValue = dataView.getFloat64(offset, false); // 64-bit float
          } else {
            throw new Error(`Unsupported BITPIX: ${bitpix}`);
          }

          offset += bytesPerPixel;
          data.push(pixelValue * bscale + bzero); // Apply scaling
        }

        // Normalize Data for Display
        const { vmin, vmax } = zscale(data);
        const normalizedData = data.map(value => ((value - vmin) / (vmax - vmin)) * 255);
		

		// console.log(header, normalizedData);
        return [ header, normalizedData , width, height, data ];
    }

    getWebviewContent() {
		return `
			<!DOCTYPE html>
	<html lang="en">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>Monochrome Image Viewer</title>
		<script src="https://d3js.org/d3.v7.min.js"></script>
		<style>
		body { 
			margin: 0; 
			display: flex; 
			justify-content: center; 
			align-items: center; 
			height: 100vh; 
		}
		#imageContainer {
			max-width: 100%;
			max-height: 100vh;
			display: flex;
			justify-content: center;
			align-items: center;
		}
		#loadedImage {
			max-width: 100%;
			max-height: 100vh;
			object-fit: contain;
		}
		#spinner {
			position: absolute;
			width: 50px;
			height: 50px;
			border: 5px solid #f3f3f3;
			border-top: 5px solid #3498db;
			border-radius: 50%;
			animation: spin 1s linear infinite;
		}
		@keyframes spin {
			0% { transform: rotate(0deg); }
			100% { transform: rotate(360deg); }
		}
			canvas {
				image-rendering: optimizeSpeed;             // Older versions of FF
				image-rendering: -moz-crisp-edges;          // FF 6.0+
				image-rendering: -webkit-optimize-contrast; // Webkit (non standard naming)
				image-rendering: -o-crisp-edges;            // OS X & Windows Opera (12.02+)
				image-rendering: crisp-edges;               // Possible future browsers.
				-ms-interpolation-mode: nearest-neighbor;   // IE (non standard naming)
			}
		</style>
	</head>
	<body>
		<div id="spinner"></div>
		<div id="imageContainer">
		<canvas id="loadedImage" style="display:none;"></canvas>
		</div>

		<script>
		const vscode = acquireVsCodeApi();
		const spinner = document.getElementById('spinner');
		const imageContainer = document.getElementById('imageContainer');
		const canvas = document.getElementById('loadedImage');
		const ctx = canvas.getContext('2d');

		let offscreenCanvas, offscreenCtx;
		let imageWidth, imageHeight;
		let currentTransform = d3.zoomIdentity;

		function renderMonochromeImage(normalizedData, width, height, originalData) {
			imageWidth = width;
			imageHeight = height;

			const pixelData = new Uint8ClampedArray(normalizedData);
			const imageData = new ImageData(width, height);
			const data = imageData.data;
				console.log("shape of originalData: ", originalData.length);
				console.log("shape of originalData: ", originalData[0].length);
				console.log("shape of normalizedData: ", normalizedData.length);

			for (let i = 0; i < pixelData.length; i++) {
			const pixelValue = pixelData[i];
			const index = i * 4;
			data[index] = pixelValue;
			data[index + 1] = pixelValue;
			data[index + 2] = pixelValue;
			data[index + 3] = 255;
			}

			canvas.width = width;
			canvas.height = height;

			offscreenCanvas = document.createElement('canvas');
			offscreenCanvas.width = width;
			offscreenCanvas.height = height;
			offscreenCtx = offscreenCanvas.getContext('2d');
			offscreenCtx.putImageData(imageData, 0, 0);

			ctx.drawImage(offscreenCanvas, 0, 0);
				ctx.webkitImageSmoothingEnabled = false;
				ctx.mozImageSmoothingEnabled = false;
				ctx.imageSmoothingEnabled = false;
				
			spinner.style.display = 'none';
			canvas.style.display = 'block';

				// Add mousemove event listener to show pixel value
				canvas.addEventListener('mousemove', (event) => {
			const rect = canvas.getBoundingClientRect();
			const scaleX = canvas.width / rect.width;
			const scaleY = canvas.height / rect.height;
					
			const x = Math.floor((event.clientX - rect.left) * scaleX);
			const y = Math.floor((event.clientY - rect.top) * scaleY);

			// Apply the current transform to get the actual pixel coordinates
			const transformedX = Math.floor((x - currentTransform.x) / currentTransform.k);
			const transformedY = Math.floor((y - currentTransform.y) / currentTransform.k);

			if (transformedX >= 0 && transformedX < width && transformedY >= 0 && transformedY < height) {
				console.log("Pixel value:", originalData[transformedY * width + transformedX]);
			}
				});
		}

		function setupZoom() {
			const zoom = d3.zoom()
			.scaleExtent([0.5, 30]) // Zoom range
			.on('zoom', (event) => {
				const transform = event.transform;
				currentTransform = transform;

				// Compute visible canvas size and resample from the original resolution
				ctx.clearRect(0, 0, canvas.width, canvas.height);
				ctx.save();
				ctx.translate(transform.x, transform.y);
				ctx.scale(transform.k, transform.k);

				// Redraw the original image with the appropriate transformation
				ctx.drawImage(offscreenCanvas, 0, 0, imageWidth, imageHeight);
				ctx.restore();
			});

			d3.select(canvas).call(zoom);
		}

		window.addEventListener('message', (event) => {
			const message = event.data;
			if (message.command === 'loadData') {
			requestAnimationFrame(() => {
				renderMonochromeImage(
				message.data, 
				message.width, 
				message.height,
							message.originalData
				);
				setupZoom(); // Initialize zoom after rendering
			});
			}
		});

		vscode.postMessage({ command: 'ready' });
		</script>
	</body>
	</html>

		`;
    }
}

exports.activate = activate;

function deactivate() {}

function zscale(values, n_samples = 1000, contrast = 0.25, max_reject = 0.5, min_npixels = 5, krej = 2.5, max_iterations = 5) {
	// Sample the image
	values = values.filter(v => isFinite(v));
	const stride = Math.max(1, Math.floor(values.length / n_samples));
	let samples = values.filter((_, index) => index % stride === 0).slice(0, n_samples);
	samples.sort((a, b) => a - b);
  
	const npix = samples.length;
	let vmin = samples[0];
	let vmax = samples[npix - 1];
  
	// Fit a line to the sorted array of samples
	const minpix = Math.max(min_npixels, Math.floor(npix * max_reject));
	const x = Array.from({ length: npix }, (_, i) => i);
	let ngoodpix = npix;
	let last_ngoodpix = npix + 1;
  
	// Bad pixels mask used in k-sigma clipping
	let badpix = new Array(npix).fill(false);
  
	// Kernel used to dilate the bad pixels mask
	const ngrow = Math.max(1, Math.floor(npix * 0.01));
	const kernel = new Array(ngrow).fill(true);
  
	let fit = { slope: 0, intercept: 0 };
  
	for (let iter = 0; iter < max_iterations; iter++) {
	  if (ngoodpix >= last_ngoodpix || ngoodpix < minpix) break;
  
	  fit = linearFit(x, samples, badpix);
	  const fitted = x.map(xi => fit.slope * xi + fit.intercept);
  
	  // Subtract fitted line from the data array
	  const flat = samples.map((s, i) => s - fitted[i]);
  
	  // Compute the k-sigma rejection threshold
	  const threshold = krej * std(flat.filter((_, i) => !badpix[i]));
  
	  // Detect and reject pixels further than k*sigma from the fitted line
	  badpix = flat.map(f => Math.abs(f) > threshold);
  
	  // Convolve with a kernel of length ngrow
	  badpix = convolve(badpix, kernel);
  
	  last_ngoodpix = ngoodpix;
	  ngoodpix = badpix.filter(b => !b).length;
	}
  
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
  
	return { vmin, vmax };
  }
  
  function linearFit(x, y, badpix) {
	const goodIndices = x.filter((_, i) => !badpix[i]);
	const goodX = goodIndices.map(i => x[i]);
	const goodY = goodIndices.map(i => y[i]);
	const n = goodX.length;
	const sumX = goodX.reduce((a, b) => a + b, 0);
	const sumY = goodY.reduce((a, b) => a + b, 0);
	const sumXY = goodX.reduce((sum, xi, i) => sum + xi * goodY[i], 0);
	const sumX2 = goodX.reduce((sum, xi) => sum + xi * xi, 0);
	const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
	const intercept = (sumY - slope * sumX) / n;
	return { slope, intercept };
  }
  
  function std(arr) {
	const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
	return Math.sqrt(arr.reduce((sum, val) => sum + (val - mean) ** 2, 0) / arr.length);
  }
  
  function convolve(arr, kernel) {
	const result = new Array(arr.length).fill(false);
	for (let i = 0; i < arr.length; i++) {
	  if (arr[i]) {
		for (let j = 0; j < kernel.length; j++) {
		  if (i + j < arr.length) {
			result[i + j] = true;
		  }
		}
	  }
	}
	return result;
  }
  
  function medianValue(arr) {
	const sorted = arr.slice().sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

module.exports = {
    activate,
    deactivate
}