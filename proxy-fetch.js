const https = require('https');

// Archive services that send no CORS headers, so the webview cannot read their
// responses (see lib/archive.js). The extension fetches only these hosts for it.
const PROXY_HOSTS = ['api.starglass.cfa.harvard.edu'];
const PROXY_TIMEOUT_MS = 120000;

/**
 * Run a webview 'proxyFetch' message ({id, url, method, headers, body}) and call
 * `post` with one 'proxyFetchResult' message: {id, status, contentType, body} with
 * the body as text, or {id, error}.
 * @returns {Function} aborts the request; `post` is then not called
 */
function proxyFetch(message, post) {
    const { id, url, method = 'GET', headers = {}, body } = message;
    let target = null;
    try {
        target = new URL(url);
    } catch {
        // not a URL: refused below
    }
    if (!target || target.protocol !== 'https:' || !PROXY_HOSTS.includes(target.hostname)) {
        post({ command: 'proxyFetchResult', id, error: `Not an allowed archive host: ${url}` });
        return () => { };
    }

    let aborted = false;
    const fail = (err) => {
        if (!aborted) post({ command: 'proxyFetchResult', id, error: err.message });
    };
    const req = https.request(target, { method, headers }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('error', fail);
        res.on('end', () => {
            if (aborted) return;
            post({
                command: 'proxyFetchResult', id,
                status: res.statusCode,
                contentType: res.headers['content-type'] || '',
                body: Buffer.concat(chunks).toString('utf8'),
            });
        });
    });
    req.setTimeout(PROXY_TIMEOUT_MS, () => req.destroy(new Error(`${target.hostname} did not answer`)));
    req.on('error', fail);
    if (body !== undefined) req.write(body);
    req.end();

    return () => {
        aborted = true;
        req.destroy();
    };
}

module.exports = { proxyFetch };
