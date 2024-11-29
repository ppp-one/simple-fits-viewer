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
        const filePath = path.join(__dirname, 'webview.html');
        const content = fs.readFileSync(filePath, 'utf8');
        return content;
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