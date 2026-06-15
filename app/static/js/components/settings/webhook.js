import { apiGet, apiPost } from '../../api.js';

export async function renderWebhookTab(container) {
  container.innerHTML = '<div class="p-3" style="color:#e0e0e0">Loading...</div>';
  let data;
  try {
    data = await apiGet('/settings/webhook');
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger m-3">Failed to load webhook settings: ${err.message}</div>`;
    return;
  }

  const baseUrl = window.location.origin;
  const exampleWorkflow = 'My%20Workflow';
  const exampleKey = data.api_key || '<your-api-key>';
  const webhookBase = `${baseUrl}/api/v1/webhooks/workflows/`;
  const urlTokenBase = `${baseUrl}/api/v1/webhooks/run/`;

  const curlExample =
`# Invoke by workflow name (URL-encode spaces as %20)
curl -X POST "${webhookBase}${exampleWorkflow}" \\
  -H "X-API-Key: ${exampleKey}"

# Or using Authorization: Bearer
curl -X POST "${webhookBase}${exampleWorkflow}" \\
  -H "Authorization: Bearer ${exampleKey}"`;

  const streamDeckExample =
`Stream Deck Web Requests plugin (or KMtronic URL Button):

  Method:  POST
  URL:     ${webhookBase}{Workflow Name}
  Header:  X-API-Key: ${exampleKey}

  (No request body needed)

Example for a workflow named "Ham Shack Startup":
  URL: ${webhookBase}Ham%20Shack%20Startup`;

  const mobileExample =
`iOS Shortcut / Android HTTP Request:

  Method:  POST
  URL:     ${webhookBase}{Workflow Name}
  Headers:
    X-API-Key: ${exampleKey}

  (No body required — 202 response means accepted)`;

  function buildIftttExample(key) {
    const k = key || '<your-api-key>';
    return `IFTTT "Make a web request" action settings:

  Method:       POST
  URL:          ${urlTokenBase}${k}/{Workflow Name}
  Content Type: application/json
  Body:         (leave empty)

Example — trigger the "Startup" workflow:
  URL: ${urlTokenBase}${k}/Startup

The API key is part of the URL — no headers needed.
Copy it from the panel above when you generate/regenerate.

── Alexa setup (via IFTTT) ────────────────────────────

1. Go to ifttt.com → Create
2. IF THIS  → Amazon Alexa → "Say a specific phrase"
             Phrase: "run shack startup"   (choose any phrase)
3. THEN THAT → Webhooks → "Make a web request"
             URL: ${urlTokenBase}${k}/Startup
             Method: POST
             Content Type: application/json
             Body: (leave empty)
4. Save the applet.
5. In the Alexa app, enable the IFTTT skill if not already enabled.
6. Say: "Alexa, trigger run shack startup"

Repeat for each workflow (Shutdown, etc.) with a different phrase.`;
  }

  container.innerHTML = `
    <div class="card">
      <div class="card-header"><i class="bi bi-link-45deg me-2"></i>Remote Webhook API</div>
      <div class="card-body">
        <div id="wh-msg" class="alert" style="display:none"></div>

        <p style="font-size:0.875rem;color:#a0a8b8">
          Invoke any workflow remotely via HTTP POST — from a Stream Deck, mobile shortcut, or any HTTP client.
          All calls require HTTPS and a global API key. Rate limited to 30 requests/minute.
        </p>

        <div class="mb-4">
          <label class="form-label fw-semibold">API Key</label>
          <div class="input-group mb-1">
            <input type="text" class="form-control font-monospace" id="wh-key-display"
                   value="${data.api_key || '(not generated yet)'}" readonly style="font-size:0.8rem" />
            <button type="button" class="btn btn-outline-secondary" id="btn-copy-wh-key"
                    ${!data.api_key ? 'disabled' : ''}>Copy</button>
            <button type="button" class="btn btn-outline-warning" id="btn-regen-wh-key">
              ${data.api_key ? 'Regenerate' : 'Generate Key'}
            </button>
          </div>
          <div class="form-text">
            ${data.api_key
              ? 'Key is stored securely. Only the last 4 characters are shown. Use Regenerate to issue a new key.'
              : 'No key generated yet. Click Generate Key to create one.'}
          </div>
        </div>

        <div id="wh-new-key-panel" style="display:none" class="mb-4">
          <div class="alert alert-warning py-2">
            <i class="bi bi-exclamation-triangle me-1"></i>
            <strong>Copy this key now</strong> — it won&apos;t be shown in full again.
          </div>
          <div class="input-group">
            <input type="text" class="form-control font-monospace" id="wh-new-key-value"
                   readonly style="font-size:0.8rem" />
            <button type="button" class="btn btn-success" id="btn-copy-new-key">Copy</button>
          </div>
        </div>

        <div class="mb-3">
          <label class="form-label fw-semibold">Usage Examples</label>
          <ul class="nav nav-tabs mb-3" id="wh-example-tabs">
            <li class="nav-item">
              <a class="nav-link active" href="#" data-wh-tab="curl">curl</a>
            </li>
            <li class="nav-item">
              <a class="nav-link" href="#" data-wh-tab="streamdeck">Stream Deck</a>
            </li>
            <li class="nav-item">
              <a class="nav-link" href="#" data-wh-tab="mobile">Mobile</a>
            </li>
            <li class="nav-item">
              <a class="nav-link" href="#" data-wh-tab="ifttt">IFTTT / Alexa</a>
            </li>
          </ul>

          <div id="wh-tab-curl">
            <pre class="p-3 rounded" style="background:#1a1a2e;color:#e0e0e0;font-size:0.75rem;white-space:pre-wrap">${curlExample}</pre>
          </div>
          <div id="wh-tab-streamdeck" style="display:none">
            <pre class="p-3 rounded" style="background:#1a1a2e;color:#e0e0e0;font-size:0.75rem;white-space:pre-wrap">${streamDeckExample}</pre>
          </div>
          <div id="wh-tab-mobile" style="display:none">
            <pre class="p-3 rounded" style="background:#1a1a2e;color:#e0e0e0;font-size:0.75rem;white-space:pre-wrap">${mobileExample}</pre>
          </div>
          <div id="wh-tab-ifttt" style="display:none">
            <pre class="p-3 rounded" id="wh-ifttt-example" style="background:#1a1a2e;color:#e0e0e0;font-size:0.75rem;white-space:pre-wrap">${buildIftttExample(null)}</pre>
          </div>
        </div>

        <div style="font-size:0.8rem;color:#94a3b8">
          <i class="bi bi-info-circle me-1"></i>
          Workflow names are case-sensitive. Spaces must be URL-encoded as <code>%20</code>.
          A successful invocation returns <code>202 Accepted</code>; check the Events log to confirm execution.
        </div>
      </div>
    </div>
  `;

  // Tab switching
  document.querySelectorAll('[data-wh-tab]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('[data-wh-tab]').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      ['curl', 'streamdeck', 'mobile', 'ifttt'].forEach(t => {
        document.getElementById(`wh-tab-${t}`).style.display = link.dataset.whTab === t ? '' : 'none';
      });
    });
  });

  document.getElementById('btn-copy-wh-key').addEventListener('click', () => {
    const val = document.getElementById('wh-key-display').value;
    if (!val || val === '(not generated yet)') return;
    navigator.clipboard.writeText(val);
    const btn = document.getElementById('btn-copy-wh-key');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  });

  document.getElementById('btn-copy-new-key').addEventListener('click', () => {
    const val = document.getElementById('wh-new-key-value').value;
    navigator.clipboard.writeText(val);
    const btn = document.getElementById('btn-copy-new-key');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  });

  document.getElementById('btn-regen-wh-key').addEventListener('click', async () => {
    const msg = document.getElementById('wh-msg');
    const isRegen = !!data.api_key;
    if (isRegen && !confirm('Regenerate the API key? Any Stream Deck buttons or apps using the current key will stop working until updated.')) return;
    try {
      const result = await apiPost('/settings/webhook/regenerate-key', {});
      // Show the full key once
      document.getElementById('wh-new-key-value').value = result.api_key;
      document.getElementById('wh-new-key-panel').style.display = '';
      // Update the masked display
      const masked = '****' + result.api_key.slice(-4);
      document.getElementById('wh-key-display').value = masked;
      document.getElementById('btn-copy-wh-key').disabled = false;
      document.getElementById('btn-regen-wh-key').textContent = 'Regenerate';
      data.api_key = masked;
      // Update IFTTT example with the real key while it's available in this session
      const iftttEl = document.getElementById('wh-ifttt-example');
      if (iftttEl) iftttEl.textContent = buildIftttExample(result.api_key);
      msg.className = 'alert alert-success';
      msg.textContent = isRegen ? 'API key regenerated. Copy and update your devices.' : 'API key generated. Copy it now.';
      msg.style.display = '';
    } catch (err) {
      msg.className = 'alert alert-danger';
      msg.textContent = err.message;
      msg.style.display = '';
    }
  });
}
