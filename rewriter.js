/**
 * Craft Engine — Smart Rewriter
 * Uses SillyTavern's LLM connection to rewrite responses that score below threshold.
 * Only fires when quality is below the configured threshold — saves tokens.
 */

import { analyzeResponse } from './analyzer.js';
import { STYLE_PRESETS } from './craft-rules.js';
import { callLLM } from './api-client.js';

/**
 * Build the rewrite prompt based on analysis results.
 * Targeted — only asks for fixes on the specific issues found.
 */
function buildRewritePrompt(originalText, analysis, settings) {
    const preset = STYLE_PRESETS[settings.activePreset] || STYLE_PRESETS['abercrombie-action'];
    const suggestions = analysis.suggestions;

    let prompt = `You are a prose editor. Rewrite the following text to fix the specific issues listed below. `;
    prompt += `Preserve the original meaning, characters, plot points, and dialogue content. `;
    prompt += `Only improve the CRAFT — sentence rhythm, sensory detail, word choice, and structure.\n\n`;

    // Style target
    prompt += `TARGET STYLE: ${preset.craftPrompt}\n\n`;

    // Specific issues to fix
    prompt += `ISSUES TO FIX:\n`;
    for (const suggestion of suggestions) {
        prompt += `- ${suggestion}\n`;
    }

    // Slop replacements
    if (analysis.categories.slop.totalMatches > 0) {
        prompt += `\nSLOP TO REMOVE (replace with specific, concrete alternatives):\n`;
        for (const match of analysis.categories.slop.matches.slice(0, 10)) {
            prompt += `- "${match.phrase}"${match.count > 1 ? ` (appears ${match.count} times)` : ''}\n`;
        }
    }

    // Voice profile injection (if available)
    if (settings.activeVoiceProfiles && settings.activeVoiceProfiles.length > 0) {
        prompt += `\nCHARACTER VOICE RULES:\n`;
        for (const profile of settings.activeVoiceProfiles) {
            prompt += `- ${profile.name}: ${profile.voiceGuide}\n`;
        }
    }

    // Custom rules
    if (settings.customRewriteRules) {
        prompt += `\nADDITIONAL RULES: ${settings.customRewriteRules}\n`;
    }

    prompt += `\nORIGINAL TEXT:\n${originalText}\n\n`;
    prompt += `REWRITTEN TEXT (output ONLY the rewritten prose, no commentary):`;

    return prompt;
}

/**
 * Attempt to rewrite a response using the SillyTavern LLM.
 * Returns { rewritten, analysis, diff } or null if rewrite not needed.
 */
export async function smartRewrite(originalText, settings, context) {
    const analysis = analyzeResponse(originalText, {
        modelType: settings.modelType || 'all',
        activePreset: settings.activePreset
    });

    // Check if rewrite is needed
    const threshold = settings.rewriteThreshold || 65;
    if (analysis.overallScore >= threshold) {
        return { rewritten: null, analysis, skipped: true, reason: `Score ${analysis.overallScore} >= threshold ${threshold}` };
    }

    // Build the rewrite prompt
    const rewritePrompt = buildRewritePrompt(originalText, analysis, settings);

    try {
        let rewrittenText;

        // Use the unified API client (handles auto/reverse-proxy/custom modes)
        rewrittenText = await callLLM(rewritePrompt, settings, context);

        // Clean up the rewritten text
        rewrittenText = cleanRewrittenText(rewrittenText);

        // Re-analyze the rewritten version
        const newAnalysis = analyzeResponse(rewrittenText, {
            modelType: settings.modelType || 'all',
            activePreset: settings.activePreset
        });

        // Only use the rewrite if it's actually better
        if (newAnalysis.overallScore <= analysis.overallScore) {
            return {
                rewritten: null,
                analysis,
                skipped: true,
                reason: `Rewrite scored ${newAnalysis.overallScore} (not better than original ${analysis.overallScore})`
            };
        }

        // Generate diff info
        const diff = generateDiff(originalText, rewrittenText);

        return {
            rewritten: rewrittenText,
            analysis,
            newAnalysis,
            diff,
            skipped: false,
            improvement: newAnalysis.overallScore - analysis.overallScore
        };
    } catch (error) {
        console.error('[CraftEngine] Rewrite failed:', error);
        return { rewritten: null, analysis, skipped: true, reason: `Error: ${error.message}` };
    }
}

/**
 * Clean up LLM output — remove any meta-commentary, markdown headers, etc.
 */
function cleanRewrittenText(text) {
    if (!text) return '';

    // Remove common LLM preamble
    text = text.replace(/^(Here'?s?\s*(is\s*)?the\s*rewritten\s*(text|version|prose)\s*:?\s*\n*)/i, '');
    text = text.replace(/^(REWRITTEN TEXT:?\s*\n*)/i, '');
    text = text.replace(/^(Sure[,!]?\s*(here'?s?\s*(is\s*)?)?.*?:\s*\n*)/i, '');

    // Remove trailing commentary
    text = text.replace(/\n*(---\n*)?(\*\*?(Note|Changes|Improvements|I've|Key changes).*$)/si, '');

    return text.trim();
}

/**
 * Simple line-level diff for the UI.
 */
function generateDiff(original, rewritten) {
    const origLines = original.split('\n');
    const newLines = rewritten.split('\n');
    const changes = [];

    const maxLen = Math.max(origLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
        const origLine = origLines[i] || '';
        const newLine = newLines[i] || '';

        if (origLine !== newLine) {
            changes.push({
                line: i + 1,
                original: origLine,
                rewritten: newLine
            });
        }
    }

    return {
        totalChanges: changes.length,
        changes: changes.slice(0, 20) // Cap for UI
    };
}

function countWords(text) {
    return text.split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Manual polish — triggered by the user clicking the polish button.
 * Always rewrites regardless of score.
 */
export async function manualPolish(originalText, settings, context) {
    const analysis = analyzeResponse(originalText, {
        modelType: settings.modelType || 'all',
        activePreset: settings.activePreset
    });

    const rewritePrompt = buildRewritePrompt(originalText, analysis, settings);

    try {
        let rewrittenText;

        // Use the unified API client
        rewrittenText = await callLLM(rewritePrompt, settings, context);

        rewrittenText = cleanRewrittenText(rewrittenText);
        const newAnalysis = analyzeResponse(rewrittenText, {
            modelType: settings.modelType || 'all',
            activePreset: settings.activePreset
        });

        return {
            rewritten: rewrittenText,
            analysis,
            newAnalysis,
            diff: generateDiff(originalText, rewrittenText),
            skipped: false,
            improvement: newAnalysis.overallScore - analysis.overallScore
        };
    } catch (error) {
        console.error('[CraftEngine] Manual polish failed:', error);
        throw error;
    }
}
