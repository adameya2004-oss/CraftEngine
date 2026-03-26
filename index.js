/**
 * Craft Engine — Main Entry Point
 * SillyTavern Extension that intercepts AI responses and improves writing quality
 * using craft rules derived from 22-book statistical analysis.
 *
 * Three interception points:
 * 1. generate_interceptor (pre-gen) — injects craft rules into prompt
 * 2. MESSAGE_RECEIVED (post-gen, pre-render) — analyzes + optionally rewrites
 * 3. CHARACTER_MESSAGE_RENDERED (post-render) — adds UI badges + polish button
 */

import { analyzeResponse, quickScore } from './analyzer.js';
import { smartRewrite, manualPolish } from './rewriter.js';
import { buildCraftInjection, STYLE_PRESETS } from './craft-rules.js';
import { importFromWiki, listCategoryPages, searchPages, listCategories } from './wiki-importer.js';
import { extractText, extractLore, extractStyleGuide, extractVoiceProfiles } from './file-importer.js';
import { profileCharacter, buildVoiceEntry } from './voice-profiler.js';
import { detectConnection, describeConnection, testConnection } from './api-client.js';
import { scanChat, highlightSlopInChat, clearSlopHighlights, batchFixChat, buildReviewReport, buildHeatmap, buildCharacterSlopReport } from './chat-reviewer.js';
import { getCharacterSlopProfile, clearCharacterSlop } from './analyzer.js';
import { surgicalReplace, exportAsSTRegex, quickFix } from './surgical-replace.js';

// ─── Extension State ────────────────────────────────────────────────

const EXTENSION_NAME = 'CraftEngine';
const DEFAULT_SETTINGS = {
    enabled: true,
    autoAnalyze: true,
    showBadges: true,
    modelType: 'all',
    autoRewrite: false,
    rewriteThreshold: 55,
    showDiff: true,
    activePreset: 'abercrombie-action',
    customRules: '',
    customRewriteRules: '',
    voiceProfiles: [],
    customPresets: [],
    wikiImportHistory: [],
    // API connection settings
    apiMode: 'auto', // 'auto' | 'reverse-proxy' | 'custom'
    proxyEndpoint: '',
    proxyApiKey: '',
    proxyModel: 'claude-sonnet-4-20250514',
    proxyFormat: 'auto',
    proxyCustomHeaders: '',
    customEndpoint: '',
    customApiKey: '',
    customModel: '',
    maxTokens: 4096,
    temperature: 0.7,
    // Chat review
    batchFixLimit: 10,
    // Structural detection
    structuralDetection: true,
    // Whitelist/blacklist
    slopWhitelist: '',
    slopBlacklist: ''
};

let settings = { ...DEFAULT_SETTINGS };
let analysisCache = new Map(); // messageId → analysis result
let activeDetailPanel = null;

// ─── SillyTavern Context ────────────────────────────────────────────

function getContext() {
    return SillyTavern.getContext();
}

function getSettings() {
    const context = getContext();
    if (!context.extensionSettings[EXTENSION_NAME]) {
        context.extensionSettings[EXTENSION_NAME] = { ...DEFAULT_SETTINGS };
    }
    settings = context.extensionSettings[EXTENSION_NAME];
    return settings;
}

function saveSettings() {
    const context = getContext();
    context.extensionSettings[EXTENSION_NAME] = settings;
    context.saveSettingsDebounced();
}

// ─── Generate Interceptor (Pre-Generation) ──────────────────────────
// Declared in manifest.json as "craftEngineInterceptor"
// Injects craft rules into the prompt BEFORE the AI generates.

window.craftEngineInterceptor = function (chat, contextSize, abort, type) {
    if (!settings.enabled) return;
    if (type === 'quiet') return; // Don't intercept our own quiet prompts

    const injection = buildCraftInjection(settings);

    // Inject as a system-level message at the end of the chat array
    // This puts craft rules close to the generation point for maximum impact
    chat.push({
        role: 'system',
        content: injection,
        injected: true // Flag so we can identify our injection
    });

    // Inject active voice profiles
    if (settings.voiceProfiles && settings.voiceProfiles.length > 0) {
        const activeProfiles = settings.voiceProfiles.filter(p => p.active);
        if (activeProfiles.length > 0) {
            const voiceInjection = activeProfiles.map(p =>
                `[Voice of ${p.name}]: ${p.voiceGuide}`
            ).join('\n');

            chat.push({
                role: 'system',
                content: `[Craft Engine — Character Voice Profiles]\n${voiceInjection}`,
                injected: true
            });
        }
    }
};

// ─── MESSAGE_RECEIVED Handler (Post-Gen, Pre-Render) ────────────────

async function onMessageReceived(messageId) {
    if (!settings.enabled || !settings.autoAnalyze) return;

    const context = getContext();
    const message = context.chat[messageId];
    if (!message || !message.mes || message.is_user) return;

    const text = message.mes;
    if (text.length < 50) return; // Skip very short messages

    // Get user's last message for echoing detection
    let userMessage = null;
    for (let i = messageId - 1; i >= 0; i--) {
        if (context.chat[i]?.is_user) { userMessage = context.chat[i].mes; break; }
    }

    // Parse whitelist/blacklist from newline-separated strings
    const whitelist = (settings.slopWhitelist || '').split('\n').map(s => s.trim()).filter(Boolean);
    const blacklist = (settings.slopBlacklist || '').split('\n').map(s => s.trim()).filter(Boolean);

    // Analyze
    const analysis = analyzeResponse(text, {
        modelType: settings.modelType,
        activePreset: settings.activePreset,
        userMessage,
        characterName: message.name || null,
        whitelist,
        blacklist
    });

    analysisCache.set(messageId, analysis);

    // Update settings panel
    updateAnalysisDisplay(analysis);

    // Auto-rewrite if enabled and below threshold
    if (settings.autoRewrite && analysis.overallScore < settings.rewriteThreshold) {
        const result = await smartRewrite(text, {
            ...settings,
            activeVoiceProfiles: settings.voiceProfiles?.filter(p => p.active) || []
        }, context);

        if (result.rewritten && !result.skipped) {
            // Store original for diff view
            if (!message.extra) message.extra = {};
            message.extra.craftOriginal = text;
            message.extra.craftAnalysis = analysis;
            message.extra.craftNewAnalysis = result.newAnalysis;
            message.extra.craftDiff = result.diff;

            // Replace message text
            message.mes = result.rewritten;
            analysisCache.set(messageId, result.newAnalysis);

            console.log(`[CraftEngine] Rewrote message ${messageId}: ${analysis.overallScore} → ${result.newAnalysis.overallScore}`);
        }
    }
}

// ─── CHARACTER_MESSAGE_RENDERED Handler (Post-Render UI) ────────────

function onCharacterMessageRendered(messageId) {
    if (!settings.enabled || !settings.showBadges) return;

    const context = getContext();
    const message = context.chat[messageId];
    if (!message || message.is_user) return;

    // Get or compute analysis
    let analysis = analysisCache.get(messageId);
    if (!analysis && message.mes && message.mes.length >= 50) {
        analysis = analyzeResponse(message.mes, {
            modelType: settings.modelType,
            activePreset: settings.activePreset
        });
        analysisCache.set(messageId, analysis);
    }

    if (!analysis) return;

    // Find the message element
    const messageElement = document.querySelector(`[mesid="${messageId}"] .mes_text`);
    if (!messageElement) return;

    // Check if badge already exists
    if (messageElement.querySelector('.craft-badge')) return;

    // Create badge container
    const badgeContainer = document.createElement('div');
    badgeContainer.style.display = 'flex';
    badgeContainer.style.alignItems = 'center';
    badgeContainer.style.marginTop = '6px';

    // Quality badge
    const badge = document.createElement('span');
    badge.className = `craft-badge grade-${analysis.grade}`;
    badge.textContent = `${analysis.grade} ${analysis.overallScore}`;
    badge.title = 'Click for details';
    badge.addEventListener('click', (e) => showDetailPanel(e, messageId, analysis));
    badgeContainer.appendChild(badge);

    // Slop count indicator
    if (analysis.categories.slop.totalMatches > 0) {
        const slopBadge = document.createElement('span');
        slopBadge.className = 'craft-badge grade-F';
        slopBadge.textContent = `${analysis.categories.slop.totalMatches} slop`;
        slopBadge.style.fontSize = '10px';
        badgeContainer.appendChild(slopBadge);
    }

    // Polish button
    const polishBtn = document.createElement('span');
    polishBtn.className = 'craft-polish-btn';
    polishBtn.innerHTML = '&#10024; Polish';
    polishBtn.addEventListener('click', () => handlePolish(messageId));
    badgeContainer.appendChild(polishBtn);

    // Diff indicator (if this message was auto-rewritten)
    if (message.extra?.craftOriginal) {
        const diffBtn = document.createElement('span');
        diffBtn.className = 'craft-polish-btn';
        diffBtn.innerHTML = '&#128269; Diff';
        diffBtn.style.background = 'rgba(33, 150, 243, 0.2)';
        diffBtn.style.color = '#64b5f6';
        diffBtn.addEventListener('click', () => showDiffView(messageId));
        badgeContainer.appendChild(diffBtn);
    }

    messageElement.appendChild(badgeContainer);
}

// ─── Polish Handler ─────────────────────────────────────────────────

async function handlePolish(messageId) {
    const context = getContext();
    const message = context.chat[messageId];
    if (!message) return;

    // Find and disable the button
    const btn = document.querySelector(`[mesid="${messageId}"] .craft-polish-btn`);
    if (btn) {
        btn.classList.add('polishing');
        btn.innerHTML = '&#10024; Polishing...';
    }

    try {
        const result = await manualPolish(message.mes, {
            ...settings,
            activeVoiceProfiles: settings.voiceProfiles?.filter(p => p.active) || []
        }, context);

        if (result.rewritten) {
            // Store original
            if (!message.extra) message.extra = {};
            message.extra.craftOriginal = message.mes;
            message.extra.craftDiff = result.diff;

            // Replace
            message.mes = result.rewritten;

            // Update display
            const messageElement = document.querySelector(`[mesid="${messageId}"] .mes_text`);
            if (messageElement) {
                // ST uses markdown rendering — we need to re-render
                // For now, just update the text content
                const textContent = messageElement.querySelector('p') || messageElement;
                // Trigger ST's re-render
                context.eventSource.emit(context.event_types?.MESSAGE_UPDATED || 'MESSAGE_UPDATED', messageId);
            }

            // Update badge
            const newAnalysis = analyzeResponse(result.rewritten, {
                modelType: settings.modelType,
                activePreset: settings.activePreset
            });
            analysisCache.set(messageId, newAnalysis);

            // Update the badge text
            const badge = document.querySelector(`[mesid="${messageId}"] .craft-badge`);
            if (badge) {
                badge.className = `craft-badge grade-${newAnalysis.grade}`;
                badge.textContent = `${newAnalysis.grade} ${newAnalysis.overallScore}`;
            }

            if (settings.showDiff) {
                showDiffView(messageId);
            }
        }
    } catch (error) {
        console.error('[CraftEngine] Polish failed:', error);
    } finally {
        if (btn) {
            btn.classList.remove('polishing');
            btn.innerHTML = '&#10024; Polish';
        }
    }
}

// ─── Detail Panel ───────────────────────────────────────────────────

function showDetailPanel(event, messageId, analysis) {
    // Remove existing panel
    if (activeDetailPanel) {
        activeDetailPanel.remove();
        activeDetailPanel = null;
    }

    const panel = document.createElement('div');
    panel.className = 'craft-detail-panel';

    const cats = analysis.categories;
    const scoreClass = (score) => score >= 80 ? 'good' : score >= 60 ? 'okay' : 'bad';

    panel.innerHTML = `
        <h3>Craft Analysis — ${analysis.grade} (${analysis.overallScore})</h3>
        <div class="craft-detail-row">
            <span class="craft-detail-label">Scene Type</span>
            <span class="craft-detail-value">${analysis.sceneType}</span>
        </div>
        <div class="craft-detail-row">
            <span class="craft-detail-label">Words / Sentences</span>
            <span class="craft-detail-value">${analysis.wordCount} / ${analysis.sentenceCount}</span>
        </div>
        <hr style="border-color: #333; margin: 6px 0;">
        <div class="craft-detail-row">
            <span class="craft-detail-label">Rhythm</span>
            <span class="craft-detail-value ${scoreClass(cats.rhythm.score)}">${cats.rhythm.score}</span>
        </div>
        <div style="font-size: 10px; color: #777; padding: 2px 0;">${cats.rhythm.details}</div>
        <div class="craft-detail-row">
            <span class="craft-detail-label">Sensory Density</span>
            <span class="craft-detail-value ${scoreClass(cats.sensory.score)}">${cats.sensory.score}</span>
        </div>
        <div style="font-size: 10px; color: #777; padding: 2px 0;">${cats.sensory.details}</div>
        <div class="craft-detail-row">
            <span class="craft-detail-label">Slop Detection</span>
            <span class="craft-detail-value ${scoreClass(cats.slop.score)}">${cats.slop.score}</span>
        </div>
        <div style="font-size: 10px; color: #777; padding: 2px 0;">${cats.slop.details}</div>
        ${cats.dialogue.score >= 0 ? `
        <div class="craft-detail-row">
            <span class="craft-detail-label">Dialogue</span>
            <span class="craft-detail-value ${scoreClass(cats.dialogue.score)}">${cats.dialogue.score}</span>
        </div>
        <div style="font-size: 10px; color: #777; padding: 2px 0;">${cats.dialogue.details}</div>
        ` : ''}
        <div class="craft-detail-row">
            <span class="craft-detail-label">Repetition</span>
            <span class="craft-detail-value ${scoreClass(cats.repetition.score)}">${cats.repetition.score}</span>
        </div>
        <div style="font-size: 10px; color: #777; padding: 2px 0;">${cats.repetition.details}</div>
        <div class="craft-detail-row">
            <span class="craft-detail-label">Ending</span>
            <span class="craft-detail-value ${scoreClass(cats.ending.score)}">${cats.ending.score}</span>
        </div>
        ${analysis.suggestions.length > 0 ? `
        <div class="craft-suggestions">
            <h4>Suggestions</h4>
            <ul style="list-style: none; padding: 0; margin: 0;">
                ${analysis.suggestions.map(s => `<li>${s}</li>`).join('')}
            </ul>
        </div>
        ` : ''}
    `;

    // Position near the click
    panel.style.left = `${Math.min(event.clientX, window.innerWidth - 420)}px`;
    panel.style.top = `${Math.min(event.clientY, window.innerHeight - 520)}px`;

    // Close on click outside
    const closeHandler = (e) => {
        if (!panel.contains(e.target) && !e.target.classList.contains('craft-badge')) {
            panel.remove();
            activeDetailPanel = null;
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 100);

    document.body.appendChild(panel);
    activeDetailPanel = panel;
}

// ─── Diff View ──────────────────────────────────────────────────────

function showDiffView(messageId) {
    const context = getContext();
    const message = context.chat[messageId];
    if (!message?.extra?.craftOriginal) return;

    // Remove existing panel
    if (activeDetailPanel) {
        activeDetailPanel.remove();
        activeDetailPanel = null;
    }

    const panel = document.createElement('div');
    panel.className = 'craft-detail-panel';
    panel.style.maxWidth = '500px';

    const diff = message.extra.craftDiff;
    const origAnalysis = message.extra.craftAnalysis;
    const newAnalysis = message.extra.craftNewAnalysis || analysisCache.get(messageId);

    let diffHtml = '<div class="craft-diff">';
    if (diff && diff.changes) {
        for (const change of diff.changes.slice(0, 15)) {
            if (change.original) {
                diffHtml += `<div class="craft-diff-line craft-diff-removed">${escapeHtml(change.original)}</div>`;
            }
            if (change.rewritten) {
                diffHtml += `<div class="craft-diff-line craft-diff-added">${escapeHtml(change.rewritten)}</div>`;
            }
        }
    }
    diffHtml += '</div>';

    panel.innerHTML = `
        <h3>Rewrite Diff</h3>
        ${origAnalysis && newAnalysis ? `
        <div class="craft-detail-row">
            <span class="craft-detail-label">Score Change</span>
            <span class="craft-detail-value good">${origAnalysis.overallScore} → ${newAnalysis.overallScore} (+${newAnalysis.overallScore - origAnalysis.overallScore})</span>
        </div>
        ` : ''}
        <div style="font-size: 11px; color: #999; margin: 4px 0;">Red = removed, Green = added</div>
        ${diffHtml}
        <button class="menu_button" style="margin-top: 8px; width: 100%;" onclick="this.closest('.craft-detail-panel').remove()">Close</button>
    `;

    panel.style.left = '50%';
    panel.style.top = '50%';
    panel.style.transform = 'translate(-50%, -50%)';

    document.body.appendChild(panel);
    activeDetailPanel = panel;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ─── Settings Panel UI Updates ──────────────────────────────────────

function updateAnalysisDisplay(analysis) {
    const container = document.getElementById('craft-last-analysis');
    if (!container) return;

    const cats = analysis.categories;
    const scoreClass = (score) => score >= 80 ? 'good' : score >= 60 ? 'okay' : 'bad';

    container.innerHTML = `
        <div style="font-size: 18px; font-weight: bold; margin-bottom: 6px;">
            <span class="craft-detail-value ${scoreClass(analysis.overallScore)}">${analysis.grade} (${analysis.overallScore})</span>
            <span style="font-size: 11px; color: #888; margin-left: 8px;">${analysis.sceneType} | ${analysis.wordCount} words</span>
        </div>
        <div class="craft-score-grid">
            <div class="craft-score-item"><span>Rhythm</span><span class="craft-detail-value ${scoreClass(cats.rhythm.score)}">${cats.rhythm.score}</span></div>
            <div class="craft-score-item"><span>Sensory</span><span class="craft-detail-value ${scoreClass(cats.sensory.score)}">${cats.sensory.score}</span></div>
            <div class="craft-score-item"><span>Slop</span><span class="craft-detail-value ${scoreClass(cats.slop.score)}">${cats.slop.score}</span></div>
            <div class="craft-score-item"><span>Repeat</span><span class="craft-detail-value ${scoreClass(cats.repetition.score)}">${cats.repetition.score}</span></div>
            ${cats.dialogue.score >= 0 ? `<div class="craft-score-item"><span>Dialogue</span><span class="craft-detail-value ${scoreClass(cats.dialogue.score)}">${cats.dialogue.score}</span></div>` : ''}
            <div class="craft-score-item"><span>Ending</span><span class="craft-detail-value ${scoreClass(cats.ending.score)}">${cats.ending.score}</span></div>
        </div>
        ${analysis.suggestions.length > 0 ? `
        <div class="craft-suggestions" style="margin-top: 6px;">
            <h4>Suggestions</h4>
            <ul style="list-style: none; padding: 0; margin: 0;">
                ${analysis.suggestions.slice(0, 5).map(s => `<li>${s}</li>`).join('')}
            </ul>
        </div>
        ` : '<div style="color: #66bb6a; font-size: 11px; margin-top: 6px;">No issues detected.</div>'}
    `;
}

function updateVoiceProfileDisplay() {
    const container = document.getElementById('craft-voice-profiles');
    if (!container) return;

    if (!settings.voiceProfiles || settings.voiceProfiles.length === 0) {
        container.innerHTML = '<p class="craft-muted">No voice profiles loaded. Import from wiki or file.</p>';
        return;
    }

    container.innerHTML = settings.voiceProfiles.map((profile, idx) => `
        <div class="craft-voice-card">
            <div class="craft-voice-name">${escapeHtml(profile.name)}</div>
            <div class="craft-voice-guide">${escapeHtml(profile.voiceGuide?.substring(0, 200) || 'No guide generated.')}</div>
            <div class="craft-voice-actions">
                <button onclick="craftToggleVoice(${idx})">${profile.active ? 'Deactivate' : 'Activate'}</button>
                <button onclick="craftRemoveVoice(${idx})">Remove</button>
            </div>
        </div>
    `).join('');
}

// Global functions for button onclick handlers
window.craftToggleVoice = function (idx) {
    if (settings.voiceProfiles[idx]) {
        settings.voiceProfiles[idx].active = !settings.voiceProfiles[idx].active;
        saveSettings();
        updateVoiceProfileDisplay();
    }
};

window.craftRemoveVoice = function (idx) {
    if (settings.voiceProfiles[idx]) {
        settings.voiceProfiles.splice(idx, 1);
        saveSettings();
        updateVoiceProfileDisplay();
    }
};

// ─── Wiki Import UI ─────────────────────────────────────────────────

function setupWikiUI() {
    const connectBtn = document.getElementById('craft-wiki-connect');
    const findBtn = document.getElementById('craft-wiki-find');
    const importBtn = document.getElementById('craft-wiki-import');
    const wikiPanel = document.getElementById('craft-wiki-panel');

    if (!connectBtn) return;

    connectBtn.addEventListener('click', () => {
        const url = document.getElementById('craft-wiki-url').value.trim();
        if (!url) return;

        wikiPanel.style.display = 'block';
        connectBtn.textContent = 'Connected';
        connectBtn.style.opacity = '0.7';
    });

    findBtn?.addEventListener('click', async () => {
        const wikiUrl = document.getElementById('craft-wiki-url').value.trim();
        const mode = document.getElementById('craft-wiki-mode').value;
        const query = document.getElementById('craft-wiki-query').value.trim();
        const resultsContainer = document.getElementById('craft-wiki-results');

        if (!wikiUrl || !query) return;

        resultsContainer.innerHTML = '<p class="craft-muted craft-analyzing">Searching...</p>';

        try {
            let pages;
            if (mode === 'category') {
                pages = await listCategoryPages(wikiUrl, query, 100);
            } else {
                pages = await searchPages(wikiUrl, query, 50);
            }

            resultsContainer.innerHTML = pages.map(p => `
                <div class="craft-wiki-item">
                    <input type="checkbox" class="craft-wiki-select" data-title="${escapeHtml(p.title)}" checked />
                    <span>${escapeHtml(p.title)}</span>
                    ${p.snippet ? `<span class="craft-wiki-snippet">${escapeHtml(p.snippet)}</span>` : ''}
                </div>
            `).join('');

            if (importBtn) importBtn.disabled = false;
        } catch (error) {
            resultsContainer.innerHTML = `<p class="craft-muted" style="color: #ef5350;">Error: ${escapeHtml(error.message)}</p>`;
        }
    });

    importBtn?.addEventListener('click', async () => {
        const wikiUrl = document.getElementById('craft-wiki-url').value.trim();
        const checkboxes = document.querySelectorAll('.craft-wiki-select:checked');
        const selectedPages = [...checkboxes].map(cb => cb.dataset.title);
        const includeQuotes = document.getElementById('craft-wiki-quotes')?.checked ?? true;
        const depth = parseInt(document.getElementById('craft-wiki-depth')?.value || '4');

        if (selectedPages.length === 0) return;

        const progressContainer = document.getElementById('craft-wiki-progress');
        const progressFill = progressContainer?.querySelector('.craft-progress-fill');
        const progressText = progressContainer?.querySelector('.craft-progress-text');
        if (progressContainer) progressContainer.style.display = 'block';
        importBtn.disabled = true;

        try {
            const context = getContext();
            const result = await importFromWiki(wikiUrl, {
                selectedPages,
                includeQuotes,
                depth
            }, context, (progress) => {
                if (progressFill) progressFill.style.width = `${Math.max(0, progress.pct)}%`;
                if (progressText) progressText.textContent = progress.detail;
            });

            // Download lorebook as JSON
            const blob = new Blob([JSON.stringify(result.lorebook, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${result.lorebook.originalData.name.replace(/\s+/g, '_')}.json`;
            a.click();
            URL.revokeObjectURL(url);

            // Extract voice profiles from characters with quotes
            const characters = result.condensedPages?.filter(p => p.quotes?.length > 0) || [];
            for (const char of characters) {
                const profile = await profileCharacter(char.name || char.title, {
                    quotes: char.quotes,
                    wikiPersonality: char.personality,
                    wikiSpeechPattern: char.speechPattern
                }, context, settings);

                if (profile.voiceGuide) {
                    settings.voiceProfiles.push({
                        name: char.name || char.title,
                        voiceGuide: profile.voiceGuide,
                        active: true,
                        source: 'wiki'
                    });
                }
            }

            saveSettings();
            updateVoiceProfileDisplay();

            if (progressText) {
                progressText.textContent = `Done! ${result.stats.entriesCreated} entries. Lorebook downloaded. ${characters.length} voice profiles created.`;
            }
        } catch (error) {
            if (progressText) progressText.textContent = `Error: ${error.message}`;
            console.error('[CraftEngine] Wiki import failed:', error);
        } finally {
            importBtn.disabled = false;
        }
    });
}

// ─── File Import UI ─────────────────────────────────────────────────

function setupFileUI() {
    const fileInput = document.getElementById('craft-file-input');
    const processBtn = document.getElementById('craft-file-process');
    const modeSelect = document.getElementById('craft-file-mode');
    const optionsPanel = document.getElementById('craft-file-options');

    if (!fileInput) return;

    fileInput.addEventListener('change', () => {
        if (processBtn) processBtn.disabled = fileInput.files.length === 0;
        if (optionsPanel) optionsPanel.style.display = fileInput.files.length > 0 ? 'block' : 'none';
    });

    processBtn?.addEventListener('click', async () => {
        const files = fileInput.files;
        if (!files || files.length === 0) return;

        const mode = modeSelect?.value || 'lore';
        const progressContainer = document.getElementById('craft-file-progress');
        const progressFill = progressContainer?.querySelector('.craft-progress-fill');
        const progressText = progressContainer?.querySelector('.craft-progress-text');
        if (progressContainer) progressContainer.style.display = 'block';
        processBtn.disabled = true;

        try {
            const context = getContext();

            // Extract text from all files
            let allText = '';
            for (const file of files) {
                if (progressText) progressText.textContent = `Reading ${file.name}...`;
                const text = await extractText(file);
                allText += text + '\n\n';
            }

            if (mode === 'lore') {
                const fandomName = document.getElementById('craft-file-fandom')?.value || 'Unknown';
                const entries = await extractLore(allText, { fandomName }, context, (progress) => {
                    if (progressFill) progressFill.style.width = `${progress.pct}%`;
                    if (progressText) progressText.textContent = progress.detail;
                }, settings);

                // Build and download lorebook
                const { buildLorebook, buildLorebookEntry } = await import('./wiki-importer.js');
                const lorebookEntries = entries.map((entry, idx) =>
                    buildLorebookEntry({
                        name: entry.name,
                        aliases: entry.keywords || [],
                        description: entry.description
                    }, entry.type || 'general', idx)
                );

                const lorebook = buildLorebook(lorebookEntries, `${fandomName} Lore`, 'Imported from files by Craft Engine');

                const blob = new Blob([JSON.stringify(lorebook, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${fandomName.replace(/\s+/g, '_')}_lorebook.json`;
                a.click();
                URL.revokeObjectURL(url);

                if (progressText) progressText.textContent = `Done! ${entries.length} lore entries. Lorebook downloaded.`;

            } else if (mode === 'style') {
                const authorName = document.getElementById('craft-file-author')?.value || 'Unknown';
                const workTitle = document.getElementById('craft-file-work')?.value || 'Unknown';

                if (progressText) progressText.textContent = 'Analyzing writing style...';
                if (progressFill) progressFill.style.width = '50%';

                const styleGuide = await extractStyleGuide(allText, { authorName, workTitle }, context, settings);

                if (styleGuide && !styleGuide.error) {
                    // Add as custom preset
                    settings.customPresets.push(styleGuide);
                    saveSettings();

                    // Add to preset dropdown
                    const presetSelect = document.getElementById('craft-active-preset');
                    if (presetSelect) {
                        const option = document.createElement('option');
                        option.value = `custom_${settings.customPresets.length - 1}`;
                        option.textContent = `${styleGuide.presetName} — ${styleGuide.description}`;
                        presetSelect.appendChild(option);
                    }

                    if (progressText) progressText.textContent = `Style guide created: "${styleGuide.presetName}"`;
                } else {
                    if (progressText) progressText.textContent = `Style analysis: ${styleGuide?.error || 'unknown error'}`;
                }
                if (progressFill) progressFill.style.width = '100%';

            } else if (mode === 'voice') {
                const characterNames = (document.getElementById('craft-file-characters')?.value || '')
                    .split(',').map(n => n.trim()).filter(Boolean);

                if (progressText) progressText.textContent = 'Extracting voice profiles...';
                if (progressFill) progressFill.style.width = '50%';

                const profiles = await extractVoiceProfiles(allText, { characterNames }, context, settings);

                for (const profile of profiles) {
                    settings.voiceProfiles.push({
                        name: profile.name,
                        voiceGuide: profile.voiceGuide,
                        active: true,
                        source: 'file'
                    });
                }

                saveSettings();
                updateVoiceProfileDisplay();

                if (progressText) progressText.textContent = `Done! ${profiles.length} voice profiles extracted.`;
                if (progressFill) progressFill.style.width = '100%';
            }
        } catch (error) {
            if (progressText) progressText.textContent = `Error: ${error.message}`;
            console.error('[CraftEngine] File import failed:', error);
        } finally {
            processBtn.disabled = false;
        }
    });
}

// ─── Settings Bindings ──────────────────────────────────────────────

function bindSettings() {
    const bind = (id, key, type = 'checked') => {
        const el = document.getElementById(id);
        if (!el) return;

        // Set initial value
        if (type === 'checked') el.checked = settings[key] ?? DEFAULT_SETTINGS[key];
        else if (type === 'value') el.value = settings[key] ?? DEFAULT_SETTINGS[key];

        // Listen for changes
        el.addEventListener('change', () => {
            settings[key] = type === 'checked' ? el.checked : el.value;
            saveSettings();

            // Update status banner
            const status = document.getElementById('craft-engine-status');
            if (status) {
                status.classList.toggle('disabled', !settings.enabled);
                status.querySelector('.craft-status-text').textContent =
                    settings.enabled ? 'Craft Engine Active' : 'Craft Engine Disabled';
            }
        });
    };

    bind('craft-auto-analyze', 'autoAnalyze', 'checked');
    bind('craft-show-badges', 'showBadges', 'checked');
    bind('craft-model-type', 'modelType', 'value');
    bind('craft-auto-rewrite', 'autoRewrite', 'checked');
    bind('craft-rewrite-threshold', 'rewriteThreshold', 'value');
    bind('craft-show-diff', 'showDiff', 'checked');
    bind('craft-active-preset', 'activePreset', 'value');
    bind('craft-custom-rules', 'customRules', 'value');
    bind('craft-custom-rewrite-rules', 'customRewriteRules', 'value');
    bind('craft-structural-detection', 'structuralDetection', 'checked');
    bind('craft-slop-whitelist', 'slopWhitelist', 'value');
    bind('craft-slop-blacklist', 'slopBlacklist', 'value');

    // Threshold display
    const thresholdSlider = document.getElementById('craft-rewrite-threshold');
    const thresholdDisplay = document.getElementById('craft-threshold-display');
    if (thresholdSlider && thresholdDisplay) {
        thresholdDisplay.textContent = thresholdSlider.value;
        thresholdSlider.addEventListener('input', () => {
            thresholdDisplay.textContent = thresholdSlider.value;
        });
    }
}

// ─── API Connection UI ──────────────────────────────────────────────

let lastScanResults = null;

function setupApiUI() {
    const modeSelect = document.getElementById('craft-api-mode');
    const proxyPanel = document.getElementById('craft-proxy-settings');
    const customPanel = document.getElementById('craft-custom-api-settings');
    const testBtn = document.getElementById('craft-api-test');
    const testResult = document.getElementById('craft-api-test-result');
    const detectedLabel = document.getElementById('craft-api-detected');

    if (!modeSelect) return;

    // Show detected connection
    if (detectedLabel) {
        detectedLabel.textContent = describeConnection(settings);
    }

    // Toggle panels based on mode
    const updatePanels = () => {
        const mode = modeSelect.value;
        if (proxyPanel) proxyPanel.style.display = mode === 'reverse-proxy' ? 'block' : 'none';
        if (customPanel) customPanel.style.display = mode === 'custom' ? 'block' : 'none';
        settings.apiMode = mode;
        saveSettings();
        if (detectedLabel) detectedLabel.textContent = describeConnection(settings);
    };

    modeSelect.value = settings.apiMode || 'auto';
    updatePanels();
    modeSelect.addEventListener('change', updatePanels);

    // Bind proxy fields
    const bindField = (id, key) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = settings[key] || '';
        el.addEventListener('change', () => { settings[key] = el.value; saveSettings(); });
        el.addEventListener('input', () => { settings[key] = el.value; });
    };

    bindField('craft-proxy-endpoint', 'proxyEndpoint');
    bindField('craft-proxy-apikey', 'proxyApiKey');
    bindField('craft-proxy-model', 'proxyModel');
    bindField('craft-proxy-format', 'proxyFormat');
    bindField('craft-proxy-headers', 'proxyCustomHeaders');
    bindField('craft-custom-endpoint', 'customEndpoint');
    bindField('craft-custom-apikey', 'customApiKey');
    bindField('craft-custom-model', 'customModel');

    // Test connection button
    testBtn?.addEventListener('click', async () => {
        testBtn.disabled = true;
        testBtn.textContent = 'Testing...';
        if (testResult) testResult.textContent = '';

        try {
            const context = getContext();
            const result = await testConnection(settings, context);
            if (testResult) {
                testResult.textContent = result.message;
                testResult.style.color = result.success ? '#66bb6a' : '#ef5350';
            }
        } catch (error) {
            if (testResult) {
                testResult.textContent = `Error: ${error.message}`;
                testResult.style.color = '#ef5350';
            }
        } finally {
            testBtn.disabled = false;
            testBtn.textContent = 'Test Connection';
        }
    });
}

// ─── Chat Review UI ─────────────────────────────────────────────────

function setupReviewUI() {
    const scanBtn = document.getElementById('craft-review-scan');
    const highlightBtn = document.getElementById('craft-review-highlight');
    const fixBtn = document.getElementById('craft-review-fix');
    const clearBtn = document.getElementById('craft-review-clear');
    const resultsContainer = document.getElementById('craft-review-results');
    const batchLimitInput = document.getElementById('craft-batch-limit');

    if (!scanBtn) return;

    // Bind batch limit
    if (batchLimitInput) {
        batchLimitInput.value = settings.batchFixLimit || 10;
        batchLimitInput.addEventListener('change', () => {
            settings.batchFixLimit = parseInt(batchLimitInput.value) || 10;
            saveSettings();
        });
    }

    // Scan Chat
    scanBtn.addEventListener('click', () => {
        const context = getContext();
        scanBtn.textContent = 'Scanning...';
        scanBtn.disabled = true;

        // Use setTimeout to let the UI update before the synchronous scan
        setTimeout(() => {
            lastScanResults = scanChat(context, settings);
            if (resultsContainer) {
                resultsContainer.innerHTML = buildReviewReport(lastScanResults);
            }
            if (fixBtn) fixBtn.disabled = !lastScanResults?.belowThreshold?.length;

            // Populate heatmap
            const heatmapContainer = document.getElementById('craft-heatmap-container');
            const heatmapEl = document.getElementById('craft-heatmap');
            if (heatmapContainer && heatmapEl && lastScanResults?.results?.length) {
                heatmapEl.innerHTML = buildHeatmap(lastScanResults);
                heatmapContainer.style.display = 'block';

                // Click heatmap cell to scroll to message
                heatmapEl.querySelectorAll('.craft-heatmap-cell').forEach(cell => {
                    cell.addEventListener('click', () => {
                        const mesid = cell.dataset.mesid;
                        const msgEl = document.querySelector(`[mesid="${mesid}"]`);
                        if (msgEl) msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    });
                });
            }

            // Populate per-character slop
            const charSlopContainer = document.getElementById('craft-character-slop');
            const charSlopList = document.getElementById('craft-character-slop-list');
            if (charSlopContainer && charSlopList && lastScanResults?.results?.length) {
                charSlopList.innerHTML = buildCharacterSlopReport(lastScanResults, context.chat);
                charSlopContainer.style.display = 'block';
            }

            scanBtn.textContent = 'Scan Chat for Slop';
            scanBtn.disabled = false;
        }, 50);
    });

    // Highlight Slop
    highlightBtn.addEventListener('click', () => {
        const context = getContext();
        highlightBtn.textContent = 'Highlighting...';
        setTimeout(() => {
            const count = highlightSlopInChat(context, settings);
            highlightBtn.textContent = `Highlight Slop (${count} found)`;
            setTimeout(() => { highlightBtn.textContent = 'Highlight Slop'; }, 3000);
        }, 50);
    });

    // Clear Highlights
    clearBtn?.addEventListener('click', () => {
        clearSlopHighlights();
    });

    // Batch Fix
    fixBtn?.addEventListener('click', async () => {
        if (!lastScanResults) return;

        const context = getContext();
        const progressContainer = document.getElementById('craft-review-progress');
        const progressFill = progressContainer?.querySelector('.craft-progress-fill');
        const progressText = progressContainer?.querySelector('.craft-progress-text');
        if (progressContainer) progressContainer.style.display = 'block';
        fixBtn.disabled = true;
        fixBtn.textContent = 'Fixing...';

        try {
            const results = await batchFixChat(context, settings, lastScanResults, (progress) => {
                if (progressFill) progressFill.style.width = `${progress.pct || 0}%`;
                if (progressText) progressText.textContent = progress.detail;
            });

            // Re-scan to update results
            lastScanResults = scanChat(context, settings);
            if (resultsContainer) {
                resultsContainer.innerHTML = buildReviewReport(lastScanResults);
            }

            // Trigger ST to re-render affected messages
            for (const r of results.filter(r => !r.skipped)) {
                try {
                    context.eventSource.emit('MESSAGE_UPDATED', r.messageId);
                } catch (e) { /* ignore render errors */ }
            }

            fixBtn.textContent = `Fixed ${results.filter(r => !r.skipped).length} messages`;
            setTimeout(() => { fixBtn.textContent = 'Fix Worst Messages'; }, 4000);
        } catch (error) {
            console.error('[CraftEngine] Batch fix failed:', error);
            if (progressText) progressText.textContent = `Error: ${error.message}`;
        } finally {
            fixBtn.disabled = !lastScanResults?.belowThreshold?.length;
        }
    });
}

// ─── Slash Command Registration ─────────────────────────────────────

function registerSlashCommands() {
    const context = getContext();
    if (!context.SlashCommandParser) return;

    try {
        // /craft — Manual analyze + show results
        context.SlashCommandParser.addCommandObject({
            name: 'craft',
            callback: async (args, value) => {
                const lastMessageIdx = context.chat.length - 1;
                const message = context.chat[lastMessageIdx];
                if (!message || message.is_user) return 'No AI message to analyze.';

                const analysis = analyzeResponse(message.mes, {
                    modelType: settings.modelType,
                    activePreset: settings.activePreset
                });
                analysisCache.set(lastMessageIdx, analysis);
                updateAnalysisDisplay(analysis);

                return `Craft Analysis: ${analysis.grade} (${analysis.overallScore}) | ${analysis.suggestions.length} suggestions`;
            },
            helpString: 'Analyze the last AI message for writing quality.'
        });

        // /polish — Manual rewrite
        context.SlashCommandParser.addCommandObject({
            name: 'polish',
            callback: async (args, value) => {
                const lastMessageIdx = context.chat.length - 1;
                await handlePolish(lastMessageIdx);
                return 'Polishing complete.';
            },
            helpString: 'Rewrite the last AI message using craft rules.'
        });

        // /craft-review — Scan entire chat for slop
        context.SlashCommandParser.addCommandObject({
            name: 'craft-review',
            callback: async (args, value) => {
                const ctx = getContext();
                const results = scanChat(ctx, settings);
                lastScanResults = results;
                if (!results) return 'No messages to scan.';
                const container = document.getElementById('craft-review-results');
                if (container) container.innerHTML = buildReviewReport(results);
                const fixBtn = document.getElementById('craft-review-fix');
                if (fixBtn) fixBtn.disabled = !results.belowThreshold?.length;
                return `Scanned ${results.aiMessageCount} messages. Average: ${results.avgScore} | ${results.totalSlop} slop hits | ${results.belowThreshold.length} below threshold`;
            },
            helpString: 'Scan all AI messages in chat for writing quality issues.'
        });

        // /craft-highlight — Highlight slop phrases inline
        context.SlashCommandParser.addCommandObject({
            name: 'craft-highlight',
            callback: async (args, value) => {
                const ctx = getContext();
                const count = highlightSlopInChat(ctx, settings);
                return `Highlighted ${count} slop phrases in chat.`;
            },
            helpString: 'Highlight slop phrases in chat messages with wavy underlines.'
        });

        // /craft-fix — Batch fix worst messages
        context.SlashCommandParser.addCommandObject({
            name: 'craft-fix',
            callback: async (args, value) => {
                if (!lastScanResults) {
                    const ctx = getContext();
                    lastScanResults = scanChat(ctx, settings);
                }
                if (!lastScanResults?.belowThreshold?.length) return 'No messages below threshold to fix.';

                const ctx = getContext();
                const results = await batchFixChat(ctx, settings, lastScanResults, (progress) => {
                    const progressText = document.querySelector('#craft-review-progress .craft-progress-text');
                    if (progressText) progressText.textContent = progress.detail;
                });

                const fixed = results.filter(r => !r.skipped).length;
                // Re-render affected messages
                for (const r of results.filter(r => !r.skipped)) {
                    try { ctx.eventSource.emit('MESSAGE_UPDATED', r.messageId); } catch (e) {}
                }
                return `Fixed ${fixed}/${results.length} messages.`;
            },
            helpString: 'Rewrite the worst messages in chat using craft rules.'
        });

        // /craft-quickfix — Zero-cost surgical slop replacement
        context.SlashCommandParser.addCommandObject({
            name: 'craft-quickfix',
            callback: async (args, value) => {
                const lastMessageIdx = context.chat.length - 1;
                const message = context.chat[lastMessageIdx];
                if (!message || message.is_user) return 'No AI message to fix.';

                const result = quickFix(message.mes, {
                    modelType: settings.modelType,
                    whitelist: (settings.slopWhitelist || '').split('\n').filter(Boolean)
                });

                if (!result) return 'No slop found to replace.';

                // Store original
                if (!message.extra) message.extra = {};
                message.extra.craftOriginal = message.mes;
                message.mes = result.text;

                try { context.eventSource.emit('MESSAGE_UPDATED', lastMessageIdx); } catch (e) {}
                return `Quick-fixed ${result.count} slop phrases (zero LLM cost).`;
            },
            helpString: 'Replace slop phrases with concrete alternatives (zero LLM cost).'
        });

        // /craft-export-regex — Export slop patterns as ST regex scripts
        context.SlashCommandParser.addCommandObject({
            name: 'craft-export-regex',
            callback: async (args, value) => {
                const result = exportAsSTRegex({
                    modelType: settings.modelType,
                    whitelist: (settings.slopWhitelist || '').split('\n').filter(Boolean)
                });

                // Copy to clipboard
                try {
                    await navigator.clipboard.writeText(result.json);
                    return `Exported ${result.count} regex scripts to clipboard. Paste into ST's Regex Scripts panel.`;
                } catch (e) {
                    // Fallback: download as file
                    const blob = new Blob([result.json], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'craft-engine-antislop-regex.json';
                    a.click();
                    URL.revokeObjectURL(url);
                    return `Exported ${result.count} regex scripts as file download.`;
                }
            },
            helpString: 'Export slop detection patterns as SillyTavern regex scripts (zero-cost post-processing).'
        });

        console.log('[CraftEngine] Slash commands registered: /craft, /polish, /craft-review, /craft-highlight, /craft-fix, /craft-quickfix, /craft-export-regex');
    } catch (error) {
        console.warn('[CraftEngine] Could not register slash commands:', error);
    }
}

// ─── Initialization ─────────────────────────────────────────────────

(async function init() {
    try {
        const context = getContext();

        // Load settings
        getSettings();

        // Load HTML template
        const settingsHtml = await fetch(`${context.extensionFolderPath || '/scripts/extensions/third-party/CraftEngine'}/settings.html`);
        if (settingsHtml.ok) {
            const html = await settingsHtml.text();
            const container = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
            if (container) {
                container.insertAdjacentHTML('beforeend', html);
            }
        }

        // Bind settings UI
        bindSettings();
        setupApiUI();
        setupReviewUI();
        setupWikiUI();
        setupFileUI();
        updateVoiceProfileDisplay();

        // Register event listeners
        const events = context.event_types;
        if (events) {
            context.eventSource.on(events.MESSAGE_RECEIVED, onMessageReceived);
            context.eventSource.on(events.CHARACTER_MESSAGE_RENDERED, onCharacterMessageRendered);
        }

        // Register slash commands
        registerSlashCommands();

        console.log('[CraftEngine] Initialized. Style preset:', settings.activePreset);
        console.log('[CraftEngine] Voice profiles:', settings.voiceProfiles?.length || 0);
        console.log('[CraftEngine] Auto-analyze:', settings.autoAnalyze, '| Auto-rewrite:', settings.autoRewrite);

    } catch (error) {
        console.error('[CraftEngine] Initialization failed:', error);
    }
})();
