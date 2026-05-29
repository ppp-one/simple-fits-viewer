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
        vscode.window.registerCustomEditorProvider('fitFileViewer', new FITSFileEditor(context), {
            webviewOptions: { retainContextWhenHidden: true }
        })
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
                vscode.Uri.file(__dirname),
                vscode.Uri.file(path.join(__dirname, 'lib')),
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
                            // Convert the document URI to a webview URI (kept as fallback)
                            const fitsFileUri = webviewPanel.webview.asWebviewUri(document.uri);

                            // Read the autoZScale setting
                            const config = vscode.workspace.getConfiguration('simple-fits-viewer');
                            const autoZScale = config.get('autoZScale', true);
                            const doDrawApertureCircles = config.get('drawApertureCircles', true);
                            const useGPU = config.get('useGPU', true);

                            log(`Webview ready — sending loadData (autoZScale=${autoZScale}, drawApertureCircles=${doDrawApertureCircles}, useGPU=${useGPU})`);

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

        // Watch the file on disk for changes (e.g. new capture written by acquisition software)
        const fitsFileUri = webviewPanel.webview.asWebviewUri(document.uri);
        const fileWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.Uri.file(path.dirname(document.uri.fsPath)), path.basename(document.uri.fsPath))
        );
        fileWatcher.onDidChange(() => {
            log(`File changed on disk: ${path.basename(document.uri.fsPath)} — reloading`);
            webviewPanel.webview.postMessage({ command: 'reload', fileUri: fitsFileUri.toString() });
        });

        // Clean up subscriptions when panel is disposed
        webviewPanel.onDidDispose(() => {
            log(`Webview disposed: ${path.basename(document.uri.fsPath)}`);
            fileWatcher.dispose();
            configChangeSubscription.dispose();
        });
    }

    getWebviewContent(webview) {
        const filePath = path.join(__dirname, 'webview.html');
        let content = fs.readFileSync(filePath, 'utf8');

        const d3Uri = webview.asWebviewUri(vscode.Uri.file(path.join(__dirname, 'd3.v7.min.js')));
        const libUri = webview.asWebviewUri(vscode.Uri.file(path.join(__dirname, 'lib', 'fits-viewer.js')));
        const styleUri = webview.asWebviewUri(vscode.Uri.file(path.join(__dirname, 'style.css')));

        const scripts = [
            `<link rel="stylesheet" href="${styleUri}">`,
            `<script src="${d3Uri}"></script>`,
            `<script type="module" src="${libUri}"></script>`,
        ].join('\n    ');

        content = content.replace('__FITS_VIEWER_SCRIPTS__', scripts);
        return content;
    }
}

exports.activate = activate;

function deactivate() { }

module.exports = {
    activate,
    deactivate
}
