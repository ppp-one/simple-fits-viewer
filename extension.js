const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function activate(context) {
    console.log("Extension 'simple-fits-viewer' is now active!");
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

                            // Send the data to the webview
                            webviewPanel.webview.postMessage({
                                command: 'loadData',
                                fileUri: fitsFileUri.toString(),
                                autoZScale: autoZScale,
                                doDrawApertureCircles: doDrawApertureCircles
                            });
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
                console.log(error);
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
                webviewPanel.webview.postMessage({
                    command: 'settingChanged',
                    autoZScale: autoZScale
                });
            }
            if (e.affectsConfiguration('simple-fits-viewer.drawApertureCircles')) {
                const config = vscode.workspace.getConfiguration('simple-fits-viewer');
                const doDrawApertureCircles = config.get('drawApertureCircles', true);
                webviewPanel.webview.postMessage({
                    command: 'settingChanged',
                    doDrawApertureCircles: doDrawApertureCircles
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
