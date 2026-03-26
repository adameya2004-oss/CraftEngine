/**
 * Craft Engine — API Client
 * Handles LLM connections for the rewriter and analysis.
 * Three modes:
 *   1. "auto" — use SillyTavern's current connection (generateRaw/generateQuietPrompt)
 *   2. "reverse-proxy" — hit a Claude reverse proxy directly (OpenAI-compatible or Anthropic format)
 *   3. "custom" — any OpenAI-compatible endpoint (OpenRouter, local, etc.)
 *
 * Auto-detection reads ST's internal API state to show the user what's active.
 */

// ─── Connection Detection ───────────────────────────────────────────

/**
 * Detect what API connection SillyTavern is currently using.
 * Returns { type, model, endpoint, source } or null.
 */
export function detectConnection() {
    try {
        // ST stores API settings in various globals
        // Try the modern SillyTavern.getContext() approach first
        const ctx = SillyTavern?.getContext?.();
        if (!ctx) return null;

        const info = {
            type: 'unknown',
            model: 'unknown',
            endpoint: '',
            source: 'auto-detected'
        };

        // Check for Chat Completion API (Claude, GPT, etc.)
        if (typeof main_api !== 'undefined') {
            info.type = main_api; // 'openai', 'kobold', 'novel', 'textgenerationwebui', etc.
        }

        // Try to get the model name
        if (typeof model_list !== 'undefined' && typeof oai_settings !== 'undefined') {
            info.model = oai_settings?.openai_model || oai_settings?.claude_model || 'unknown';
        }

        // Try to get endpoint
        if (typeof oai_settings !== 'undefined') {
            info.endpoint = oai_settings?.reverse_proxy || oai_settings?.chat_completion_source || '';
            if (oai_settings?.reverse_proxy) {
                info.type = 'reverse-proxy';
            }
        }

        // Check if already using Claude via reverse proxy
        if (info.endpoint && (info.endpoint.includes('claude') || info.endpoint.includes('anthropic'))) {
            info.type = 'claude-proxy';
        }

        return info;
    } catch (e) {
        console.warn('[CraftEngine] Connection detection failed:', e);
        return null;
    }
}

/**
 * Get a human-readable description of the current connection.
 */
export function describeConnection(settings) {
    if (settings.apiMode === 'auto') {
        const detected = detectConnection();
        if (detected) {
            return `Using ST connection: ${detected.type} / ${detected.model}${detected.endpoint ? ` via ${new URL(detected.endpoint).hostname}` : ''}`;
        }
        return 'Using SillyTavern\'s active connection';
    }
    if (settings.apiMode === 'reverse-proxy') {
        const host = settings.proxyEndpoint ? new URL(settings.proxyEndpoint).hostname : 'not set';
        return `Reverse proxy: ${host} / ${settings.proxyModel || 'claude-sonnet-4-20250514'}`;
    }
    if (settings.apiMode === 'custom') {
        const host = settings.customEndpoint ? new URL(settings.customEndpoint).hostname : 'not set';
        return `Custom API: ${host} / ${settings.customModel || 'not set'}`;
    }
    return 'No connection configured';
}

// ─── API Callers ────────────────────────────────────────────────────

/**
 * Send a prompt to the configured LLM and get a response.
 * This is the main entry point — handles all three modes.
 */
export async function callLLM(prompt, settings, stContext) {
    const mode = settings.apiMode || 'auto';

    switch (mode) {
        case 'auto':
            return callViaSTContext(prompt, stContext);

        case 'reverse-proxy':
            return callReverseProxy(prompt, settings);

        case 'custom':
            return callCustomEndpoint(prompt, settings);

        default:
            return callViaSTContext(prompt, stContext);
    }
}

/**
 * Mode 1: Use SillyTavern's built-in generation functions.
 * This automatically uses whatever API the user has configured in ST.
 */
async function callViaSTContext(prompt, context) {
    if (context.generateRaw) {
        return await context.generateRaw(prompt, '', false, false);
    }
    if (context.generateQuietPrompt) {
        return await context.generateQuietPrompt(prompt, false, false);
    }
    throw new Error('No SillyTavern generation function available. Check your API connection.');
}

/**
 * Mode 2: Hit a Claude reverse proxy directly.
 * Supports both Anthropic Messages API format and OpenAI-compatible format.
 * Auto-detects which format the proxy expects.
 */
async function callReverseProxy(prompt, settings) {
    const endpoint = settings.proxyEndpoint;
    const apiKey = settings.proxyApiKey;
    const model = settings.proxyModel || 'claude-sonnet-4-20250514';
    const format = settings.proxyFormat || 'auto';

    if (!endpoint) throw new Error('Reverse proxy endpoint not configured.');

    // Determine the format
    let useFormat = format;
    if (format === 'auto') {
        // If endpoint contains 'anthropic' or 'claude', use Anthropic format
        // Otherwise assume OpenAI-compatible
        useFormat = (endpoint.includes('anthropic') || endpoint.includes('claude'))
            ? 'anthropic'
            : 'openai';
    }

    if (useFormat === 'anthropic') {
        return callAnthropicFormat(endpoint, apiKey, model, prompt, settings);
    } else {
        return callOpenAIFormat(endpoint, apiKey, model, prompt, settings);
    }
}

/**
 * Mode 3: Custom OpenAI-compatible endpoint (OpenRouter, local, etc.)
 */
async function callCustomEndpoint(prompt, settings) {
    const endpoint = settings.customEndpoint;
    const apiKey = settings.customApiKey;
    const model = settings.customModel || 'gpt-4';

    if (!endpoint) throw new Error('Custom API endpoint not configured.');

    return callOpenAIFormat(endpoint, apiKey, model, prompt, settings);
}

// ─── Format-Specific Callers ────────────────────────────────────────

/**
 * Call using Anthropic Messages API format.
 * POST /v1/messages
 */
async function callAnthropicFormat(endpoint, apiKey, model, prompt, settings) {
    // Normalize endpoint — add /v1/messages if not present
    let url = endpoint.replace(/\/+$/, '');
    if (!url.endsWith('/messages') && !url.endsWith('/v1/messages')) {
        url += '/v1/messages';
    }

    const headers = {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
    };

    if (apiKey) {
        headers['x-api-key'] = apiKey;
        // Some proxies also accept Authorization header
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    // Add custom headers if configured (some proxies need special auth)
    if (settings.proxyCustomHeaders) {
        try {
            const custom = JSON.parse(settings.proxyCustomHeaders);
            Object.assign(headers, custom);
        } catch (e) {
            console.warn('[CraftEngine] Invalid custom headers JSON:', e);
        }
    }

    const body = {
        model,
        max_tokens: settings.maxTokens || 4096,
        messages: [{ role: 'user', content: prompt }]
    };

    // Add system prompt if configured
    if (settings.proxySystemPrompt) {
        body.system = settings.proxySystemPrompt;
    }

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`Anthropic API error ${response.status}: ${errorText.substring(0, 200)}`);
    }

    const data = await response.json();

    // Anthropic Messages API returns { content: [{ text: "..." }] }
    if (data.content && data.content[0]) {
        return data.content[0].text;
    }

    throw new Error('Unexpected Anthropic API response format');
}

/**
 * Call using OpenAI Chat Completions format.
 * POST /v1/chat/completions
 * Works with: OpenRouter, Claude reverse proxies in OAI mode, local LLMs, etc.
 */
async function callOpenAIFormat(endpoint, apiKey, model, prompt, settings) {
    // Normalize endpoint
    let url = endpoint.replace(/\/+$/, '');
    if (!url.endsWith('/chat/completions') && !url.endsWith('/v1/chat/completions')) {
        if (url.endsWith('/v1')) {
            url += '/chat/completions';
        } else {
            url += '/v1/chat/completions';
        }
    }

    const headers = {
        'Content-Type': 'application/json'
    };

    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    // Custom headers
    if (settings.proxyCustomHeaders || settings.customHeaders) {
        try {
            const custom = JSON.parse(settings.proxyCustomHeaders || settings.customHeaders || '{}');
            Object.assign(headers, custom);
        } catch (e) {
            console.warn('[CraftEngine] Invalid custom headers JSON:', e);
        }
    }

    const body = {
        model,
        max_tokens: settings.maxTokens || 4096,
        messages: [{ role: 'user', content: prompt }],
        temperature: settings.temperature ?? 0.7
    };

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`API error ${response.status}: ${errorText.substring(0, 200)}`);
    }

    const data = await response.json();

    // OpenAI format returns { choices: [{ message: { content: "..." } }] }
    if (data.choices && data.choices[0]?.message?.content) {
        return data.choices[0].message.content;
    }

    throw new Error('Unexpected API response format');
}

/**
 * Test the current API connection. Returns { success, message, latencyMs }.
 */
export async function testConnection(settings, stContext) {
    const start = Date.now();
    try {
        const response = await callLLM('Reply with only the word "connected" and nothing else.', settings, stContext);
        const latency = Date.now() - start;
        const success = response && response.toLowerCase().includes('connect');
        return {
            success,
            message: success ? `Connected (${latency}ms)` : `Got response but unexpected content: "${response?.substring(0, 50)}"`,
            latencyMs: latency
        };
    } catch (error) {
        return {
            success: false,
            message: `Failed: ${error.message}`,
            latencyMs: Date.now() - start
        };
    }
}
