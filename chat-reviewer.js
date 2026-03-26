/**
 * Craft Engine — Chat Reviewer
 * Scans entire chat history for slop, quality issues, and provides batch fixing.
 * Three modes:
 *   1. Quick Scan — score every AI message, show aggregate stats (zero LLM cost)
 *   2. Highlight Mode — highlight slop phrases inline with wavy underlines
 *   3. Batch Fix — rewrite the worst messages in the chat using the configured LLM
 */

import { analyzeResponse } from './analyzer.js';
import { buildSlopRegex } from './slop-data.js';
import { callLLM } from './api-client.js';
import { STYLE_PRESETS, resolvePreset } from './craft-rules.js';

// ─── Quick Scan ─────────────────────────────────────────────────────

/**
 * Scan all AI messages in the current chat.
 * Returns aggregate stats + per-message scores.
 */
export function scanChat(context, settings) {
    const chat = context.chat;
    if (!chat || chat.length === 0) return null;

    const results = [];
    let totalScore = 0;
    let totalSlop = 0;
    let worstScore = 100;
    let worstIdx = -1;
    let bestScore = 0;
    let bestIdx = -1;
    const gradeDistribution = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    const allSlopPhrases = {};

    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (msg.is_user || !msg.mes || msg.mes.length < 50) continue;

        const analysis = analyzeResponse(msg.mes, {
            modelType: settings.modelType || 'all',
            activePreset: settings.activePreset
        });

        results.push({ messageId: i, analysis });
        totalScore += analysis.overallScore;
        totalSlop += analysis.categories.slop.totalMatches;
        gradeDistribution[analysis.grade]++;

        if (analysis.overallScore < worstScore) {
            worstScore = analysis.overallScore;
            worstIdx = i;
        }
        if (analysis.overallScore > bestScore) {
            bestScore = analysis.overallScore;
            bestIdx = i;
        }

        // Aggregate slop phrases
        for (const match of analysis.categories.slop.matches) {
            const phrase = match.phrase.toLowerCase();
            allSlopPhrases[phrase] = (allSlopPhrases[phrase] || 0) + (match.count || 1);
        }
    }

    const aiMessageCount = results.length;
    const avgScore = aiMessageCount > 0 ? Math.round(totalScore / aiMessageCount) : 0;

    // Sort slop by frequency
    const topSlop = Object.entries(allSlopPhrases)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20);

    // Find messages below threshold
    const threshold = settings.rewriteThreshold || 55;
    const belowThreshold = results.filter(r => r.analysis.overallScore < threshold);

    return {
        aiMessageCount,
        avgScore,
        totalSlop,
        worstScore,
        worstIdx,
        bestScore,
        bestIdx,
        gradeDistribution,
        topSlop,
        belowThreshold,
        results
    };
}

// ─── Slop Highlighting ──────────────────────────────────────────────

/**
 * Highlight slop phrases directly in rendered message elements.
 * Adds wavy red underlines to matching phrases.
 */
export function highlightSlopInChat(context, settings) {
    const chat = context.chat;
    const regex = buildSlopRegex(settings.modelType || 'all');
    let totalHighlighted = 0;

    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (msg.is_user || !msg.mes) continue;

        const messageEl = document.querySelector(`[mesid="${i}"] .mes_text`);
        if (!messageEl) continue;

        // Skip if already highlighted
        if (messageEl.dataset.craftHighlighted === 'true') continue;

        // Walk text nodes and wrap slop matches
        const walker = document.createTreeWalker(
            messageEl,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        const textNodes = [];
        let node;
        while ((node = walker.nextNode())) {
            textNodes.push(node);
        }

        for (const textNode of textNodes) {
            const text = textNode.nodeValue;
            if (!text || text.trim().length < 5) continue;

            // Reset regex for each text node
            regex.lastIndex = 0;
            const matches = [];
            let match;
            while ((match = regex.exec(text)) !== null) {
                matches.push({ index: match.index, length: match[0].length, phrase: match[0] });
            }

            if (matches.length === 0) continue;

            // Build replacement with highlights
            const fragment = document.createDocumentFragment();
            let lastIndex = 0;

            for (const m of matches) {
                // Text before match
                if (m.index > lastIndex) {
                    fragment.appendChild(document.createTextNode(text.substring(lastIndex, m.index)));
                }

                // Highlighted match
                const span = document.createElement('span');
                span.className = 'craft-slop-highlight';
                span.title = `AI slop: "${m.phrase}" — consider replacing with something specific`;
                span.textContent = text.substring(m.index, m.index + m.length);
                fragment.appendChild(span);

                lastIndex = m.index + m.length;
                totalHighlighted++;
            }

            // Remaining text
            if (lastIndex < text.length) {
                fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
            }

            textNode.parentNode.replaceChild(fragment, textNode);
        }

        messageEl.dataset.craftHighlighted = 'true';
    }

    return totalHighlighted;
}

/**
 * Remove all slop highlights from the chat.
 */
export function clearSlopHighlights() {
    const highlights = document.querySelectorAll('.craft-slop-highlight');
    for (const span of highlights) {
        const parent = span.parentNode;
        parent.replaceChild(document.createTextNode(span.textContent), span);
        parent.normalize(); // Merge adjacent text nodes
    }

    // Clear the highlighted flag
    const messages = document.querySelectorAll('[data-craft-highlighted="true"]');
    for (const msg of messages) {
        delete msg.dataset.craftHighlighted;
    }
}

// ─── Batch Fix ──────────────────────────────────────────────────────

/**
 * Rewrite the worst messages in the chat.
 * Only rewrites messages below the threshold.
 * Uses the configured API connection.
 */
export async function batchFixChat(context, settings, scanResults, onProgress) {
    const toFix = scanResults.belowThreshold
        .sort((a, b) => a.analysis.overallScore - b.analysis.overallScore)
        .slice(0, settings.batchFixLimit || 10); // Cap at 10 per batch

    if (toFix.length === 0) {
        onProgress?.({ step: 'done', detail: 'No messages below threshold to fix.', fixed: 0, total: 0 });
        return [];
    }

    const preset = resolvePreset(settings.activePreset, settings.customPresets);
    const results = [];

    for (let i = 0; i < toFix.length; i++) {
        const { messageId, analysis } = toFix[i];
        const message = context.chat[messageId];
        if (!message || !message.mes) continue;

        onProgress?.({
            step: 'fixing',
            detail: `Fixing message ${i + 1}/${toFix.length} (score: ${analysis.overallScore})...`,
            fixed: i,
            total: toFix.length,
            pct: (i / toFix.length) * 100
        });

        // Build a targeted rewrite prompt
        let prompt = `You are a prose editor. Rewrite this roleplay response to fix quality issues. `;
        prompt += `Preserve ALL original meaning, characters, plot points, and dialogue content. `;
        prompt += `Only improve craft: sentence rhythm, sensory detail, word choice, remove clichés.\n\n`;
        prompt += `STYLE: ${preset.craftPrompt}\n\n`;

        if (analysis.suggestions.length > 0) {
            prompt += `SPECIFIC ISSUES:\n`;
            for (const s of analysis.suggestions) {
                prompt += `- ${s}\n`;
            }
            prompt += '\n';
        }

        if (analysis.categories.slop.matches.length > 0) {
            prompt += `REMOVE THESE CLICHÉS:\n`;
            for (const m of analysis.categories.slop.matches.slice(0, 8)) {
                prompt += `- "${m.phrase}"\n`;
            }
            prompt += '\n';
        }

        // Inject voice profiles if active
        const activeVoices = settings.voiceProfiles?.filter(p => p.active) || [];
        if (activeVoices.length > 0) {
            prompt += `CHARACTER VOICES:\n`;
            for (const v of activeVoices) {
                prompt += `- ${v.name}: ${v.voiceGuide}\n`;
            }
            prompt += '\n';
        }

        prompt += `ORIGINAL:\n${message.mes}\n\nREWRITTEN (output ONLY the rewritten prose):`;

        try {
            const rewritten = await callLLM(prompt, settings, context);

            if (rewritten && rewritten.trim().length > 20) {
                // Clean LLM preamble
                let cleaned = rewritten
                    .replace(/^(Here'?s?\s*(is\s*)?the\s*rewritten.*?:\s*\n*)/i, '')
                    .replace(/^(REWRITTEN.*?:\s*\n*)/i, '')
                    .replace(/^(Sure.*?:\s*\n*)/i, '')
                    .replace(/\n*(---\n*)?(\*\*?(Note|Changes|Improvements|I've|Key changes).*$)/si, '')
                    .trim();

                // Re-analyze to verify improvement
                const newAnalysis = analyzeResponse(cleaned, {
                    modelType: settings.modelType || 'all',
                    activePreset: settings.activePreset
                });

                if (newAnalysis.overallScore > analysis.overallScore) {
                    // Store original
                    if (!message.extra) message.extra = {};
                    message.extra.craftOriginal = message.mes;
                    message.extra.craftAnalysis = analysis;
                    message.extra.craftNewAnalysis = newAnalysis;

                    // Apply fix
                    message.mes = cleaned;

                    results.push({
                        messageId,
                        oldScore: analysis.overallScore,
                        newScore: newAnalysis.overallScore,
                        improvement: newAnalysis.overallScore - analysis.overallScore
                    });
                } else {
                    results.push({
                        messageId,
                        oldScore: analysis.overallScore,
                        newScore: newAnalysis.overallScore,
                        skipped: true,
                        reason: 'Rewrite not better than original'
                    });
                }
            }
        } catch (error) {
            console.error(`[CraftEngine] Batch fix failed for message ${messageId}:`, error);
            results.push({
                messageId,
                oldScore: analysis.overallScore,
                skipped: true,
                reason: error.message
            });
        }

        // Brief pause between API calls
        await new Promise(r => setTimeout(r, 500));
    }

    const fixed = results.filter(r => !r.skipped).length;
    const avgImprovement = fixed > 0
        ? Math.round(results.filter(r => !r.skipped).reduce((sum, r) => sum + r.improvement, 0) / fixed)
        : 0;

    onProgress?.({
        step: 'done',
        detail: `Fixed ${fixed}/${toFix.length} messages. Average improvement: +${avgImprovement} points.`,
        fixed,
        total: toFix.length,
        pct: 100
    });

    return results;
}

// ─── Review Report Generator ────────────────────────────────────────

/**
 * Generate an HTML report from scan results for the UI panel.
 */
export function buildReviewReport(scanResults) {
    if (!scanResults) return '<p class="craft-muted">No scan data.</p>';

    const { aiMessageCount, avgScore, totalSlop, gradeDistribution, topSlop, belowThreshold, worstScore, bestScore } = scanResults;

    const avgClass = avgScore >= 80 ? 'good' : avgScore >= 60 ? 'okay' : 'bad';
    const gradeBar = Object.entries(gradeDistribution)
        .map(([grade, count]) => {
            if (count === 0) return '';
            const pct = Math.round((count / aiMessageCount) * 100);
            return `<span class="craft-badge grade-${grade}" style="font-size: 10px; margin: 1px;">${grade}: ${count} (${pct}%)</span>`;
        }).join(' ');

    let html = `
        <div style="margin-bottom: 8px;">
            <div style="font-size: 16px; font-weight: bold;">
                Chat Average: <span class="craft-detail-value ${avgClass}">${avgScore}</span>
            </div>
            <div style="font-size: 11px; color: #888;">
                ${aiMessageCount} AI messages | ${totalSlop} total slop hits | Best: ${bestScore} | Worst: ${worstScore}
            </div>
        </div>
        <div style="margin: 6px 0;">${gradeBar}</div>
    `;

    // Top slop
    if (topSlop.length > 0) {
        html += `<div class="craft-suggestions" style="margin: 6px 0;">
            <h4>Most Common Slop (across all messages)</h4>
            <ul style="list-style: none; padding: 0; margin: 0;">
                ${topSlop.slice(0, 10).map(([phrase, count]) =>
                    `<li>"${escapeHtml(phrase)}" — ${count} times</li>`
                ).join('')}
            </ul>
        </div>`;
    }

    // Messages needing fixes
    if (belowThreshold.length > 0) {
        html += `<div style="margin-top: 6px; padding: 6px; background: rgba(244, 67, 54, 0.1); border-radius: 4px; border: 1px solid rgba(244, 67, 54, 0.2);">
            <div style="font-size: 12px; font-weight: 600; color: #ef5350; margin-bottom: 4px;">
                ${belowThreshold.length} messages below threshold
            </div>
            <div style="font-size: 11px; color: #999;">
                ${belowThreshold.slice(0, 5).map(r =>
                    `Message #${r.messageId}: ${r.analysis.grade} (${r.analysis.overallScore}) — ${r.analysis.categories.slop.totalMatches} slop`
                ).join('<br>')}
                ${belowThreshold.length > 5 ? `<br>...and ${belowThreshold.length - 5} more` : ''}
            </div>
        </div>`;
    }

    return html;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
