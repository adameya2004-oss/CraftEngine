/**
 * Craft Engine — Core Analyzer
 * Pure JS analysis engine. Zero LLM calls. Scores response quality
 * using metrics derived from 22-book statistical analysis.
 */

import { ALL_SENSORY, SENSORY_WORDS, detectSceneType, getBenchmarks, BENCHMARKS } from './craft-rules.js';
import { buildSlopRegex, ECHO_STARTERS, BAD_ENDINGS, OVERUSED_TAGS, getSlopSeverity } from './slop-data.js';

// ─── Text Parsing Utilities ─────────────────────────────────────────

function splitSentences(text) {
    // Remove markdown formatting for analysis
    const clean = text
        .replace(/\*\*([^*]+)\*\*/g, '$1')   // bold
        .replace(/\*([^*]+)\*/g, '$1')         // italic
        .replace(/~~([^~]+)~~/g, '$1')         // strikethrough
        .replace(/`([^`]+)`/g, '$1')           // inline code
        .replace(/#+\s/g, '')                   // headers
        .replace(/\n{2,}/g, '\n');              // collapse blank lines

    // Split on sentence-ending punctuation followed by space or newline
    const sentences = clean
        .split(/(?<=[.!?])\s+(?=[A-Z"'\*])|(?<=[.!?])\n/)
        .map(s => s.trim())
        .filter(s => s.length > 0);

    return sentences;
}

function countWords(text) {
    return text.split(/\s+/).filter(w => w.length > 0).length;
}

function getWords(text) {
    return text.toLowerCase().replace(/[^a-z\s'-]/g, '').split(/\s+/).filter(w => w.length > 0);
}

function isDialogue(sentence) {
    return /^[""\u201C]/.test(sentence.trim()) || /[""\u201D]\s*$/.test(sentence.trim());
}

function extractDialogueLines(text) {
    const lines = [];
    const regex = /[""\u201C]([^""\u201D]+)[""\u201D]/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        lines.push(match[1].trim());
    }
    return lines;
}

function extractDialogueTags(text) {
    const tagRegex = /[""\u201D]\s*(?:,?\s*)?(\w+)\s+(\w+)/g;
    const tags = [];
    let match;
    while ((match = tagRegex.exec(text)) !== null) {
        // Check if the second word looks like a pronoun/name (subject) and first is a verb
        const verb = match[1].toLowerCase();
        const subject = match[2].toLowerCase();
        // Common pattern: "text," he said / "text," said John
        if (['said', 'asked', 'replied', 'muttered', 'whispered', 'shouted', 'growled',
             'snarled', 'hissed', 'murmured', 'breathed', 'sighed', 'demanded',
             'exclaimed', 'called', 'cried', 'snapped', 'barked', 'purred',
             'cooed', 'whimpered', 'groaned', 'moaned'].includes(verb)) {
            tags.push(verb);
        } else if (['he', 'she', 'they', 'i'].includes(verb)) {
            tags.push(subject);
        }
    }
    return tags;
}

// ─── Analysis Functions ─────────────────────────────────────────────

/**
 * Sentence Rhythm Analysis
 * Measures: avg length, stdev, short sentence %, echo starters
 */
function analyzeRhythm(sentences) {
    if (sentences.length < 3) {
        return { score: 50, avgLength: 0, stdev: 0, shortPct: 0, echoCount: 0, details: 'Too few sentences to analyze rhythm.' };
    }

    const lengths = sentences.map(s => countWords(s));
    const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((sum, l) => sum + Math.pow(l - avg, 2), 0) / lengths.length;
    const stdev = Math.sqrt(variance);
    const shortCount = lengths.filter(l => l <= 8).length;
    const shortPct = shortCount / lengths.length;

    // Check for echo starters (same pattern starting consecutive sentences)
    let echoCount = 0;
    for (let i = 1; i < sentences.length; i++) {
        for (const pattern of ECHO_STARTERS) {
            const prevMatch = pattern.test(sentences[i - 1]);
            const currMatch = pattern.test(sentences[i]);
            if (prevMatch && currMatch) {
                echoCount++;
                break;
            }
        }
    }

    // Check for 3+ consecutive same-word starts
    let tripleEcho = 0;
    for (let i = 2; i < sentences.length; i++) {
        const w1 = getWords(sentences[i - 2])[0];
        const w2 = getWords(sentences[i - 1])[0];
        const w3 = getWords(sentences[i])[0];
        if (w1 && w1 === w2 && w2 === w3) tripleEcho++;
    }

    // Score (0-100)
    let score = 70; // baseline

    // Stdev scoring — target 10-14 for general, but depends on scene type
    if (stdev >= 8 && stdev <= 17) score += 15;
    else if (stdev >= 5) score += 5;
    else score -= 15; // Very flat rhythm

    // Short sentence variety
    if (shortPct >= 0.20 && shortPct <= 0.50) score += 10;
    else if (shortPct < 0.10) score -= 10; // All long sentences

    // Echo penalty
    const echoPct = echoCount / sentences.length;
    if (echoPct > 0.3) score -= 20;
    else if (echoPct > 0.15) score -= 10;

    // Triple echo is severe
    if (tripleEcho > 0) score -= (tripleEcho * 10);

    return {
        score: Math.max(0, Math.min(100, score)),
        avgLength: Math.round(avg * 10) / 10,
        stdev: Math.round(stdev * 100) / 100,
        shortPct: Math.round(shortPct * 100) / 100,
        echoCount,
        tripleEcho,
        details: `Avg sentence: ${avg.toFixed(1)} words | Stdev: ${stdev.toFixed(1)} | Short: ${(shortPct * 100).toFixed(0)}% | Echo starts: ${echoCount}`
    };
}

/**
 * Sensory Density Analysis
 * Counts sensory words per sentence, broken down by sense type.
 */
function analyzeSensory(text, sentences) {
    const words = getWords(text);
    const sensoryCounts = { visual: 0, auditory: 0, tactile: 0, olfactory: 0, gustatory: 0 };
    let totalSensory = 0;

    for (const word of words) {
        for (const [sense, set] of Object.entries(SENSORY_WORDS)) {
            if (set.has(word)) {
                sensoryCounts[sense]++;
                totalSensory++;
                break; // Count each word once
            }
        }
    }

    const density = sentences.length > 0 ? totalSensory / sentences.length : 0;
    const sensesUsed = Object.values(sensoryCounts).filter(c => c > 0).length;

    // Score
    let score = 50;

    // Density scoring
    if (density >= 0.8) score += 25;
    else if (density >= 0.5) score += 15;
    else if (density >= 0.3) score += 5;
    else score -= 10;

    // Sense variety bonus
    if (sensesUsed >= 4) score += 15;
    else if (sensesUsed >= 3) score += 10;
    else if (sensesUsed >= 2) score += 5;

    // Smell bonus (often forgotten)
    if (sensoryCounts.olfactory > 0) score += 5;

    // Check opening (first 200 chars) for sensory front-loading
    const openingWords = getWords(text.substring(0, 200));
    const openingSensory = openingWords.filter(w => ALL_SENSORY.has(w)).length;
    if (openingSensory >= 5) score += 5;

    return {
        score: Math.max(0, Math.min(100, score)),
        density: Math.round(density * 1000) / 1000,
        sensoryCounts,
        sensesUsed,
        openingSensory,
        details: `Density: ${density.toFixed(2)}/sentence | Senses: ${sensesUsed}/5 | Opening: ${openingSensory} sensory words`
    };
}

/**
 * Slop Detection
 * Finds AI slop patterns. Returns matches with severity.
 */
function analyzeSlop(text, modelType = 'all') {
    const regex = buildSlopRegex(modelType);
    const matches = [];
    let match;

    while ((match = regex.exec(text)) !== null) {
        matches.push({
            phrase: match[0],
            index: match.index,
            severity: getSlopSeverity(match[0])
        });
    }

    // Deduplicate (same phrase appearing multiple times)
    const unique = new Map();
    for (const m of matches) {
        const key = m.phrase.toLowerCase();
        if (!unique.has(key)) {
            unique.set(key, { ...m, count: 1 });
        } else {
            unique.get(key).count++;
        }
    }

    const totalSlop = matches.length;
    const wordCount = countWords(text);
    const slopDensity = wordCount > 0 ? totalSlop / (wordCount / 100) : 0;

    // Score (inverted — lower slop is better)
    let score = 100;
    score -= totalSlop * 8;  // Each slop hit costs 8 points
    score -= [...unique.values()].filter(m => m.severity === 3).length * 15; // Corporate language extra penalty

    return {
        score: Math.max(0, Math.min(100, score)),
        totalMatches: totalSlop,
        uniqueMatches: unique.size,
        matches: [...unique.values()],
        slopDensity: Math.round(slopDensity * 100) / 100,
        details: `${totalSlop} slop hits (${unique.size} unique) | Density: ${slopDensity.toFixed(1)} per 100 words`
    };
}

/**
 * Dialogue Analysis
 * Checks tag distribution, line length, voice consistency.
 */
function analyzeDialogue(text) {
    const dialogueLines = extractDialogueLines(text);
    const tags = extractDialogueTags(text);

    if (dialogueLines.length < 2) {
        return { score: -1, details: 'Insufficient dialogue to analyze.' };
    }

    // Tag distribution
    const saidCount = tags.filter(t => t === 'said').length;
    const saidPct = tags.length > 0 ? saidCount / tags.length : 0;

    // Dialogue line lengths
    const lineLengths = dialogueLines.map(l => countWords(l));
    const avgLineLength = lineLengths.reduce((a, b) => a + b, 0) / lineLengths.length;

    // Overused creative tags
    const creativeTags = tags.filter(t => t !== 'said' && t !== 'asked');
    const overusedCount = creativeTags.filter(t => OVERUSED_TAGS.includes(t)).length;

    // Score
    let score = 60;

    // Said percentage scoring (target 55-65%)
    if (saidPct >= 0.50 && saidPct <= 0.72) score += 20;
    else if (saidPct < 0.35) score -= 10;
    else if (saidPct > 0.80) score -= 5; // A little too invisible

    // Line length (target 8-14 words)
    if (avgLineLength >= 7 && avgLineLength <= 14) score += 10;
    else if (avgLineLength > 20) score -= 10; // Characters lecturing

    // Overused tags penalty
    if (overusedCount > 3) score -= 10;

    return {
        score: Math.max(0, Math.min(100, score)),
        dialogueLines: dialogueLines.length,
        tags: tags.length,
        saidPct: Math.round(saidPct * 100) / 100,
        avgLineLength: Math.round(avgLineLength * 10) / 10,
        tagDistribution: tags.reduce((acc, t) => { acc[t] = (acc[t] || 0) + 1; return acc; }, {}),
        details: `${dialogueLines.length} lines | "said": ${(saidPct * 100).toFixed(0)}% | Avg length: ${avgLineLength.toFixed(1)} words`
    };
}

/**
 * Repetition Detection
 * Finds repeated words, phrases, and sentence structures.
 */
function analyzeRepetition(text, sentences) {
    const words = getWords(text);
    const wordCount = words.length;

    // Word frequency (excluding common words)
    const COMMON = new Set([
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'is', 'was', 'are', 'were', 'be', 'been',
        'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
        'could', 'should', 'may', 'might', 'shall', 'can', 'it', 'its',
        'he', 'she', 'they', 'his', 'her', 'their', 'him', 'them',
        'i', 'me', 'my', 'you', 'your', 'we', 'our', 'us',
        'this', 'that', 'these', 'those', 'not', 'no', 'so',
        'as', 'if', 'then', 'than', 'into', 'up', 'out',
        'just', 'like', 'back', 'over', 'down', 'through'
    ]);

    const wordFreq = {};
    for (const word of words) {
        if (!COMMON.has(word) && word.length > 3) {
            wordFreq[word] = (wordFreq[word] || 0) + 1;
        }
    }

    // Find overused words (appear more than expected)
    const expectedFreq = Math.max(2, wordCount / 100); // Roughly 1% threshold
    const overused = Object.entries(wordFreq)
        .filter(([_, count]) => count > expectedFreq * 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    // N-gram repetition (2-gram and 3-gram)
    const bigrams = {};
    const trigrams = {};
    for (let i = 0; i < words.length - 1; i++) {
        if (!COMMON.has(words[i]) || !COMMON.has(words[i + 1])) {
            const bi = `${words[i]} ${words[i + 1]}`;
            bigrams[bi] = (bigrams[bi] || 0) + 1;
        }
        if (i < words.length - 2) {
            const tri = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
            trigrams[tri] = (trigrams[tri] || 0) + 1;
        }
    }

    const repeatedBigrams = Object.entries(bigrams)
        .filter(([_, count]) => count >= 3)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    const repeatedTrigrams = Object.entries(trigrams)
        .filter(([_, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    // Score
    let score = 85;
    score -= overused.length * 3;
    score -= repeatedBigrams.length * 5;
    score -= repeatedTrigrams.length * 8;

    return {
        score: Math.max(0, Math.min(100, score)),
        overusedWords: overused,
        repeatedBigrams,
        repeatedTrigrams,
        details: `${overused.length} overused words | ${repeatedBigrams.length} repeated phrases`
    };
}

/**
 * Ending Quality Check
 */
function analyzeEnding(text) {
    const trimmed = text.trim();
    const lastParagraph = trimmed.split(/\n{2,}/).pop().trim();
    const lastSentence = splitSentences(lastParagraph).pop() || '';

    let score = 80;
    const issues = [];

    for (const pattern of BAD_ENDINGS) {
        if (pattern.test(lastParagraph)) {
            score -= 20;
            issues.push(`Bad ending pattern: ${pattern.source}`);
        }
    }

    // Check for forward movement (character doing something)
    const actionVerbs = /\b(walked|moved|turned|reached|grabbed|pulled|pushed|stepped|ran|drove|headed|climbed|stood)\b/i;
    if (actionVerbs.test(lastSentence)) score += 10;

    return {
        score: Math.max(0, Math.min(100, score)),
        lastSentence: lastSentence.substring(0, 100),
        issues,
        details: issues.length > 0 ? issues.join('; ') : 'Ending looks clean'
    };
}

// ─── Master Analysis Function ───────────────────────────────────────

/**
 * Analyze a complete AI response.
 * Returns a full quality report with per-category scores and an overall grade.
 */
export function analyzeResponse(text, options = {}) {
    const {
        modelType = 'all',
        activePreset = null,
        customBenchmarks = null
    } = options;

    const sentences = splitSentences(text);
    const sceneType = detectSceneType(text);

    const rhythm = analyzeRhythm(sentences);
    const sensory = analyzeSensory(text, sentences);
    const slop = analyzeSlop(text, modelType);
    const dialogue = analyzeDialogue(text);
    const repetition = analyzeRepetition(text, sentences);
    const ending = analyzeEnding(text);

    // Weight scores based on what matters for this scene type
    const weights = {
        action: { rhythm: 0.25, sensory: 0.30, slop: 0.20, dialogue: 0.05, repetition: 0.10, ending: 0.10 },
        romance: { rhythm: 0.20, sensory: 0.25, slop: 0.20, dialogue: 0.10, repetition: 0.10, ending: 0.15 },
        dialogue: { rhythm: 0.10, sensory: 0.10, slop: 0.20, dialogue: 0.30, repetition: 0.15, ending: 0.15 },
        general: { rhythm: 0.20, sensory: 0.15, slop: 0.25, dialogue: 0.10, repetition: 0.15, ending: 0.15 }
    };

    const w = weights[sceneType] || weights.general;

    // If dialogue analysis returned -1 (insufficient), redistribute its weight
    const effectiveDialogueScore = dialogue.score >= 0 ? dialogue.score : 0;
    const dialogueWeight = dialogue.score >= 0 ? w.dialogue : 0;
    const totalWeight = w.rhythm + w.sensory + w.slop + dialogueWeight + w.repetition + w.ending;

    const overallScore = Math.round(
        (rhythm.score * w.rhythm +
         sensory.score * w.sensory +
         slop.score * w.slop +
         effectiveDialogueScore * dialogueWeight +
         repetition.score * w.repetition +
         ending.score * w.ending) / totalWeight
    );

    // Letter grade
    let grade;
    if (overallScore >= 90) grade = 'A';
    else if (overallScore >= 80) grade = 'B';
    else if (overallScore >= 70) grade = 'C';
    else if (overallScore >= 60) grade = 'D';
    else grade = 'F';

    return {
        overallScore,
        grade,
        sceneType,
        wordCount: countWords(text),
        sentenceCount: sentences.length,
        categories: {
            rhythm,
            sensory,
            slop,
            dialogue,
            repetition,
            ending
        },
        // Quick summary for the badge
        summary: `${grade} (${overallScore}) | ${sceneType} | Rhythm: ${rhythm.score} | Sensory: ${sensory.score} | Slop: ${slop.score}`,
        // Actionable suggestions
        suggestions: generateSuggestions(rhythm, sensory, slop, dialogue, repetition, ending, sceneType)
    };
}

/**
 * Generate human-readable improvement suggestions.
 */
function generateSuggestions(rhythm, sensory, slop, dialogue, repetition, ending, sceneType) {
    const suggestions = [];

    // Rhythm suggestions
    if (rhythm.stdev < 7) {
        suggestions.push('Sentences are too uniform in length. Mix short punchy lines with longer flowing ones.');
    }
    if (rhythm.echoCount > 3) {
        suggestions.push(`${rhythm.echoCount} consecutive sentences start with the same pattern. Vary your sentence starters.`);
    }
    if (rhythm.tripleEcho > 0) {
        suggestions.push(`${rhythm.tripleEcho} instances of 3+ sentences starting with the same word. Break the pattern.`);
    }
    if (sceneType === 'action' && rhythm.shortPct < 0.25) {
        suggestions.push('Action scenes need more short sentences (target 35-45%). Compress as intensity rises.');
    }

    // Sensory suggestions
    if (sensory.density < 0.3) {
        suggestions.push('Very low sensory detail. Add specific tactile, auditory, and olfactory details.');
    }
    if (sensory.sensesUsed < 3) {
        const missing = [];
        if (sensory.sensoryCounts.olfactory === 0) missing.push('smell');
        if (sensory.sensoryCounts.auditory === 0) missing.push('sound');
        if (sensory.sensoryCounts.tactile === 0) missing.push('touch');
        suggestions.push(`Only ${sensory.sensesUsed}/5 senses used. Add ${missing.join(', ')}.`);
    }
    if (sensory.openingSensory < 3) {
        suggestions.push('Opening lacks sensory grounding. Front-load physical details in the first paragraph.');
    }

    // Slop suggestions
    if (slop.totalMatches > 0) {
        const worst = slop.matches
            .sort((a, b) => b.severity - a.severity)
            .slice(0, 3)
            .map(m => `"${m.phrase}"${m.count > 1 ? ` (×${m.count})` : ''}`);
        suggestions.push(`Slop detected: ${worst.join(', ')}. Replace with specific, concrete alternatives.`);
    }

    // Dialogue suggestions
    if (dialogue.score >= 0) {
        if (dialogue.saidPct < 0.40) {
            suggestions.push('Too many creative dialogue tags. Increase "said" usage to 55-65%.');
        }
        if (dialogue.avgLineLength > 18) {
            suggestions.push('Dialogue lines are too long (characters lecturing). Target 8-12 words per line.');
        }
    }

    // Repetition suggestions
    if (repetition.repeatedTrigrams.length > 0) {
        const phrases = repetition.repeatedTrigrams.map(([phrase, count]) => `"${phrase}" (×${count})`);
        suggestions.push(`Repeated phrases: ${phrases.join(', ')}.`);
    }
    if (repetition.overusedWords.length > 3) {
        const words = repetition.overusedWords.slice(0, 5).map(([word, count]) => `"${word}" (×${count})`);
        suggestions.push(`Overused words: ${words.join(', ')}.`);
    }

    // Ending suggestions
    if (ending.issues.length > 0) {
        suggestions.push('Weak ending. End on forward movement — a character actively doing something.');
    }

    return suggestions;
}

/**
 * Quick score — returns just the overall score and grade.
 * Use this for the badge display.
 */
export function quickScore(text, options = {}) {
    const result = analyzeResponse(text, options);
    return {
        score: result.overallScore,
        grade: result.grade,
        sceneType: result.sceneType,
        slopCount: result.categories.slop.totalMatches
    };
}
