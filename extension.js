const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const outputChannel = vscode.window.createOutputChannel('Simple FITS Viewer');

function log(message) {
    const ts = new Date().toISOString().replace('T', ' ').substring(0, 23);
    outputChannel.appendLine(`[${ts}] ${message}`);
}

function activate(context) {
    log("Extension 'simple-fits-viewer' is now active!");
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider('fitFileViewer', new FITSFileEditor(context))
    );
}

class FITSFileDocument {
    constructor(uri) {
        this.uri = uri;
    }
}

class FITSFileEditor {
    constructor(context) {
        this.context = context;
    }

    openCustomDocument(uri, openContext, token) {
        log(`Opening document: ${uri.fsPath}`);
        return new FITSFileDocument(uri);
    }

    async resolveCustomEditor(document, webviewPanel, token) {

        // Set up the webview content
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.dirname(document.uri.fsPath)),
                vscode.Uri.file(__dirname)
            ]
        };

        // Function to update webview content
        const updateWebview = () => {
            try {
                log(`Loading webview for: ${path.basename(document.uri.fsPath)}`);

                // Step 1: Update the webview content
                webviewPanel.webview.html = this.getWebviewContent(webviewPanel.webview);

                // Step 2: Send data to webview (SLOW?)
                webviewPanel.webview.onDidReceiveMessage(
                    message => {
                        if (message.command === 'ready') {
                            // Convert the document URI to a webview URI
                            const fitsFileUri = webviewPanel.webview.asWebviewUri(document.uri);

                            // Read the autoZScale setting
                            const config = vscode.workspace.getConfiguration('simple-fits-viewer');
                            const autoZScale = config.get('autoZScale', true);
                            const doDrawApertureCircles = config.get('drawApertureCircles', true);
                            const useGPU = config.get('useGPU', true);

                            log(`Webview ready — sending loadData (autoZScale=${autoZScale}, drawApertureCircles=${doDrawApertureCircles}, useGPU=${useGPU})`);

                            // Send the data to the webview
                            webviewPanel.webview.postMessage({
                                command: 'loadData',
                                fileUri: fitsFileUri.toString(),
                                autoZScale: autoZScale,
                                doDrawApertureCircles: doDrawApertureCircles,
                                useGPU: useGPU
                            });
                        }

                        if (message.command === 'log') {
                            const prefix = { error: '[ERROR]', warn: '[WARN]', time: '[TIME]' }[message.level] || '[LOG]';
                            log(`[webview] ${prefix} ${message.message}`);
                        }

                        if (message.command === 'openExternal' && message.url) {
                            try {
                                vscode.env.openExternal(vscode.Uri.parse(message.url));
                            } catch (err) {
                                vscode.window.showErrorMessage(`Failed to open external link: ${err.message}`);
                            }
                        }
                    },
                    undefined,
                    this.context.subscriptions
                );

            } catch (error) {
                log(`[ERROR] ${error.message}\n${error.stack}`);
                vscode.window.showErrorMessage(`Error reading FITS file: ${error.message}`);
            }
        };

        // Initial update
        updateWebview();

        // Listen for setting changes and notify the webview
        const configChangeSubscription = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('simple-fits-viewer.autoZScale')) {
                const config = vscode.workspace.getConfiguration('simple-fits-viewer');
                const autoZScale = config.get('autoZScale', true);
                log(`Setting changed: autoZScale=${autoZScale}`);
                webviewPanel.webview.postMessage({
                    command: 'settingChanged',
                    autoZScale: autoZScale
                });
            }
            if (e.affectsConfiguration('simple-fits-viewer.drawApertureCircles')) {
                const config = vscode.workspace.getConfiguration('simple-fits-viewer');
                const doDrawApertureCircles = config.get('drawApertureCircles', true);
                log(`Setting changed: drawApertureCircles=${doDrawApertureCircles}`);
                webviewPanel.webview.postMessage({
                    command: 'settingChanged',
                    doDrawApertureCircles: doDrawApertureCircles
                });
            }
            if (e.affectsConfiguration('simple-fits-viewer.useGPU')) {
                const config = vscode.workspace.getConfiguration('simple-fits-viewer');
                const useGPU = config.get('useGPU', true);
                log(`Setting changed: useGPU=${useGPU}`);
                webviewPanel.webview.postMessage({
                    command: 'settingChanged',
                    useGPU: useGPU
                });
            }
        });

        // Handle document changes
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.uri.toString() === document.uri.toString()) {
                updateWebview();
            }
        });

        // Clean up subscriptions when panel is disposed
        webviewPanel.onDidDispose(() => {
            log(`Webview disposed: ${path.basename(document.uri.fsPath)}`);
            changeDocumentSubscription.dispose();
            configChangeSubscription.dispose();
        });
    }

    getWebviewContent(webview) {
        const filePath = path.join(__dirname, 'webview.html');
        let content = fs.readFileSync(filePath, 'utf8');

        // Attach d3 as a file URI to avoid </script> tag injection issues
        const d3Uri = webview.asWebviewUri(vscode.Uri.file(path.join(__dirname, 'd3.v7.min.js')));
        content = content.replace('</head>', `<script src="${d3Uri}"></script></head>`);

        const utilsPath = path.join(__dirname, 'utils.js');
        const utilsContent = fs.readFileSync(utilsPath, 'utf8');

        const fwhmPath = path.join(__dirname, 'fwhm.js');
        const fwhmContent = fs.readFileSync(fwhmPath, 'utf8');

        const wcsPath = path.join(__dirname, 'wcs.js');
        const wcsContent = fs.readFileSync(wcsPath, 'utf8');

        // Attach styles.css
        const stylePath = path.join(__dirname, 'style.css');
        const styleContent = fs.readFileSync(stylePath, 'utf8');

        // Console bridge: forwards webview console output to the extension OutputChannel.
        // Must be injected after vscode (acquireVsCodeApi) is defined in the main script,
        // and before utils.js so the timing overrides are in place when those functions run.
        const consoleBridge = `
(function () {
    const _timers = {};
    const _orig = {
        log: console.log.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        time: console.time.bind(console),
        timeLog: console.timeLog.bind(console),
        timeEnd: console.timeEnd.bind(console),
    };
    function serialize(args) {
        return args.map(a => (a !== null && typeof a === 'object') ? JSON.stringify(a) : String(a)).join(' ');
    }
    function postLog(level, message) {
        vscode.postMessage({ command: 'log', level, message });
    }
    console.log = function (...args) { postLog('log', serialize(args)); _orig.log(...args); };
    console.warn = function (...args) { postLog('warn', serialize(args)); _orig.warn(...args); };
    console.error = function (...args) { postLog('error', serialize(args)); _orig.error(...args); };
    console.time = function (label) { _timers[label] = performance.now(); _orig.time(label); };
    console.timeLog = function (label, ...data) {
        const elapsed = _timers[label] !== undefined ? (performance.now() - _timers[label]).toFixed(1) : '?';
        postLog('time', label + ': ' + elapsed + 'ms' + (data.length ? ' — ' + data.join(' ') : ''));
        _orig.timeLog(label, ...data);
    };
    console.timeEnd = function (label) {
        const elapsed = _timers[label] !== undefined ? (performance.now() - _timers[label]).toFixed(1) : '?';
        postLog('time', label + ': ' + elapsed + 'ms (done)');
        delete _timers[label];
        _orig.timeEnd(label);
    };
})();`;

        // Inject the console bridge inline immediately after acquireVsCodeApi() so it is
        // active before any console.time() calls in the main webview script fire.
        content = content.replace('const vscode = acquireVsCodeApi();', `const vscode = acquireVsCodeApi();\n${consoleBridge}`);

        // Inject utils.js and styles.css content into the webview HTML
        content = content.replace('</body>', `<script>${utilsContent}</script><script>${fwhmContent}</script><script>${wcsContent}</script><style>${styleContent}</style></body>`);
        return content;
    }
}

exports.activate = activate;

function deactivate() { }

module.exports = {
    activate,
    deactivate
}
