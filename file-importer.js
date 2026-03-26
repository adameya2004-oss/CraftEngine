/**
 * Craft Engine — File/Book Importer
 * Upload .txt, .epub, .pdf files and digest them into:
 * 1. Style rules (learn writing patterns from books)
 * 2. Lore entries (extract world info from source material)
 * 3. Voice profiles (learn character speech patterns from dialogue)
 */

import { callLLM } from './api-client.js';

// ─── Text Extraction ────────────────────────────────────────────────

/**
 * Extract text from a File object.
 * Supports: .txt, .md, .json, .html
 * For .epub and .pdf, we extract what we can client-side.
 */
export async function extractText(file) {
    const name = file.name.toLowerCase();

    if (name.endsWith('.txt') || name.endsWith('.md')) {
        return await file.text();
    }

    if (name.endsWith('.json')) {
        const raw = await file.text();
        try {
            const data = JSON.parse(raw);
            // If it's a lorebook, extract content
            if (data.entries) {
                return Object.values(data.entries).map(e => e.content || '').join('\n\n');
            }
            // If it's a character card, extract description + examples
            if (data.description || data.personality) {
                return [data.description, data.personality, data.scenario,
                    data.first_mes, data.mes_example].filter(Boolean).join('\n\n');
            }
            return JSON.stringify(data, null, 2);
        } catch {
            return raw;
        }
    }

    if (name.endsWith('.html') || name.endsWith('.htm')) {
        const html = await file.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return doc.body.textContent || '';
    }

    if (name.endsWith('.epub')) {
        return await extractEpub(file);
    }

    // For other formats, try reading as text
    try {
        return await file.text();
    } catch {
        throw new Error(`Unsupported file format: ${name}`);
    }
}

/**
 * Basic EPUB extraction (ZIP containing XHTML chapters).
 * Uses the browser's built-in compression API or falls back.
 */
async function extractEpub(file) {
    try {
        // EPUBs are ZIP files — try to decompress
        const arrayBuffer = await file.arrayBuffer();

        // Check if JSZip is available (ST might have it)
        if (typeof JSZip !== 'undefined') {
            const zip = await JSZip.loadAsync(arrayBuffer);
            const texts = [];

            for (const [path, zipEntry] of Object.entries(zip.files)) {
                if (path.match(/\.(xhtml|html|htm|xml)$/i) && !zipEntry.dir) {
                    const content = await zipEntry.async('text');
                    // Strip HTML tags
                    const doc = new DOMParser().parseFromString(content, 'text/html');
                    const text = doc.body.textContent || '';
                    if (text.trim().length > 100) {
                        texts.push(text.trim());
                    }
                }
            }

            return texts.join('\n\n---\n\n');
        }

        // Fallback: read as text and hope for the best
        const text = new TextDecoder().decode(arrayBuffer);
        // Try to extract readable content between HTML tags
        const readable = text.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
        return readable;
    } catch (error) {
        throw new Error(`EPUB extraction failed: ${error.message}. Try converting to .txt first.`);
    }
}

// ─── Text Chunking ──────────────────────────────────────────────────

/**
 * Split text into chunks for LLM processing.
 * Respects paragraph boundaries.
 */
export function chunkText(text, maxChunkSize = 3000) {
    const paragraphs = text.split(/\n{2,}/);
    const chunks = [];
    let current = '';

    for (const para of paragraphs) {
        if (current.length + para.length > maxChunkSize && current.length > 0) {
            chunks.push(current.trim());
            current = '';
        }
        current += para + '\n\n';
    }

    if (current.trim()) {
        chunks.push(current.trim());
    }

    return chunks;
}

// ─── Style Analysis ─────────────────────────────────────────────────

/**
 * Analyze writing style from imported text (no LLM needed for basic stats).
 */
export function analyzeStyle(text) {
    const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(s => s.length > 0);
    const words = text.split(/\s+/).filter(w => w.length > 0);

    if (sentences.length < 10) {
        return { error: 'Not enough text for style analysis (need at least 10 sentences).' };
    }

    // Sentence length stats
    const lengths = sentences.map(s => s.split(/\s+/).length);
    const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((sum, l) => sum + Math.pow(l - avg, 2), 0) / lengths.length;
    const stdev = Math.sqrt(variance);
    const shortPct = lengths.filter(l => l <= 8).length / lengths.length;

    // Vocabulary richness
    const uniqueWords = new Set(words.map(w => w.toLowerCase().replace(/[^a-z]/g, '')).filter(w => w.length > 0));
    const vocabRichness = uniqueWords.size / words.length;

    // Dialogue detection
    const dialogueLines = text.match(/[""\u201C][^""\u201D]+[""\u201D]/g) || [];
    const dialoguePct = dialogueLines.length / sentences.length;

    // Paragraph length
    const paragraphs = text.split(/\n{2,}/).filter(p => p.trim().length > 0);
    const avgParaLength = paragraphs.reduce((sum, p) => sum + p.split(/\s+/).length, 0) / paragraphs.length;

    return {
        totalWords: words.length,
        totalSentences: sentences.length,
        avgSentenceLength: Math.round(avg * 10) / 10,
        sentenceLengthStdev: Math.round(stdev * 100) / 100,
        shortSentencePct: Math.round(shortPct * 100) / 100,
        vocabRichness: Math.round(vocabRichness * 1000) / 1000,
        dialoguePct: Math.round(dialoguePct * 100) / 100,
        avgParagraphLength: Math.round(avgParaLength * 10) / 10,
        paragraphCount: paragraphs.length
    };
}

// ─── LLM-Powered Extraction ────────────────────────────────────────

/**
 * Extract lore entries from text using LLM.
 * Each chunk → LLM → structured lore data.
 */
export async function extractLore(text, options, context, onProgress, settings) {
    const {
        fandomName = 'Unknown',
        focusType = 'all', // all, characters, locations, factions, lore
        maxEntries = 50
    } = options;

    const chunks = chunkText(text, 3000);
    const allEntries = [];

    for (let i = 0; i < chunks.length && allEntries.length < maxEntries; i++) {
        if (onProgress) {
            onProgress({ step: 'lore', detail: `Processing chunk ${i + 1}/${chunks.length}`, pct: (i / chunks.length) * 100 });
        }

        const prompt = `You are extracting lore data from source material for the "${fandomName}" universe.

Analyze this text excerpt and extract any ${focusType === 'all' ? 'characters, locations, factions, items, or world rules' : focusType} mentioned.

TEXT:
${chunks[i]}

For each entity found, output a JSON array of objects. Each object should have:
{
  "name": "entity name",
  "type": "character|location|faction|item|lore_rule",
  "description": "2-3 sentences capturing the essential information for roleplay",
  "keywords": ["activation keywords for lorebook"]
}

If no relevant entities are found in this chunk, return an empty array: []
Only include entities with enough detail to be useful. Skip passing mentions.

Output ONLY the JSON array:`;

        try {
            const response = await callLLM(prompt, settings || {}, context);

            if (response) {
                const jsonMatch = response.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    const entries = JSON.parse(jsonMatch[0]);
                    allEntries.push(...entries);
                }
            }
        } catch (error) {
            console.warn(`[CraftEngine] Lore extraction failed for chunk ${i}:`, error);
        }
    }

    // Deduplicate by name
    const seen = new Set();
    const dedupedEntries = allEntries.filter(entry => {
        const key = entry.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    if (onProgress) {
        onProgress({ step: 'lore', detail: `Extracted ${dedupedEntries.length} lore entries`, pct: 100 });
    }

    return dedupedEntries;
}

/**
 * Extract a style guide from text using LLM.
 * Analyzes an author's writing patterns and creates a reusable style preset.
 */
export async function extractStyleGuide(text, options, context, settings) {
    const {
        authorName = 'Unknown Author',
        workTitle = 'Unknown Work'
    } = options;

    // Get basic stats first (free)
    const stats = analyzeStyle(text);

    // Sample 3 chunks spread across the text for diversity
    const chunks = chunkText(text, 2000);
    const sampleIndices = [0, Math.floor(chunks.length / 2), chunks.length - 1];
    const samples = sampleIndices.map(i => chunks[Math.min(i, chunks.length - 1)]).join('\n\n---\n\n');

    const prompt = `Analyze the writing style of ${authorName} from "${workTitle}" based on these excerpts and statistics.

STATISTICAL ANALYSIS (computed from full text):
- Average sentence length: ${stats.avgSentenceLength} words
- Sentence length stdev: ${stats.sentenceLengthStdev}
- Short sentence %: ${(stats.shortSentencePct * 100).toFixed(0)}%
- Vocabulary richness: ${stats.vocabRichness}
- Dialogue %: ${(stats.dialoguePct * 100).toFixed(0)}%

TEXT SAMPLES:
${samples.substring(0, 4000)}

Create a writing style guide that captures this author's distinctive voice. Output as JSON:
{
  "presetName": "a short identifier (e.g., 'sanderson-epic', 'butcher-noir')",
  "description": "1 sentence describing the style",
  "craftPrompt": "A detailed paragraph of writing instructions that would make an AI replicate this style. Include: sentence rhythm patterns, sensory density approach, dialogue style, pacing tendencies, vocabulary level, tone, and any signature techniques.",
  "benchmarks": {
    "avgSentenceLength": ${stats.avgSentenceLength},
    "shortSentencePct": ${stats.shortSentencePct},
    "sentenceLengthStdev": ${stats.sentenceLengthStdev}
  },
  "signaturePatterns": ["list of 3-5 distinctive style patterns this author uses"]
}`;

    try {
        const response = await callLLM(prompt, settings || {}, context);

        if (response) {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const styleGuide = JSON.parse(jsonMatch[0]);
                return { ...styleGuide, stats };
            }
        }

        return { error: 'Failed to generate style guide', stats };
    } catch (error) {
        console.error('[CraftEngine] Style guide extraction failed:', error);
        return { error: error.message, stats };
    }
}

/**
 * Extract character voice profiles from text.
 * Finds dialogue, identifies speakers, analyzes speech patterns.
 */
export async function extractVoiceProfiles(text, options, context, settings) {
    const {
        characterNames = [], // If provided, focus on these characters
        maxCharacters = 10
    } = options;

    const chunks = chunkText(text, 4000);
    const sample = chunks.slice(0, 5).join('\n\n---\n\n');

    const charFilter = characterNames.length > 0
        ? `Focus specifically on these characters: ${characterNames.join(', ')}.`
        : `Identify the ${maxCharacters} most prominent speaking characters.`;

    const prompt = `Analyze the dialogue in this text to extract character voice profiles.

${charFilter}

TEXT:
${sample.substring(0, 6000)}

For each character, output a JSON array:
[
  {
    "name": "character name",
    "vocabularyLevel": "simple|moderate|complex|archaic",
    "sentenceStyle": "description of how they construct sentences (short/long, fragments, run-ons, etc.)",
    "verbalTics": ["catchphrases, filler words, repeated expressions"],
    "emotionalRange": "how they express emotions in dialogue (restrained, explosive, sardonic, etc.)",
    "addressStyle": "how they address others (formal titles, nicknames, crude, etc.)",
    "uniquePatterns": "any distinctive speech patterns (accent markers, dialect, specific word choices)",
    "voiceGuide": "A 2-3 sentence instruction for writing dialogue as this character that captures their SOUND."
  }
]

Output ONLY the JSON array:`;

    try {
        const response = await callLLM(prompt, settings || {}, context);

        if (response) {
            const jsonMatch = response.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        }

        return [];
    } catch (error) {
        console.error('[CraftEngine] Voice profile extraction failed:', error);
        return [];
    }
}
