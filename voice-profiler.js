/**
 * Craft Engine — Voice Profiler
 * Analyzes character speech patterns from quotes, wiki data, or imported text.
 * Generates voice guides that enforce character consistency in AI responses.
 */

import { callLLM } from './api-client.js';

/**
 * Analyze quotes to extract a voice profile (no LLM needed for basic analysis).
 */
export function analyzeQuotes(quotes) {
    if (!quotes || quotes.length < 3) {
        return null;
    }

    // Basic stats
    const lengths = quotes.map(q => q.split(/\s+/).length);
    const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;

    // Vocabulary analysis
    const allWords = quotes.join(' ').toLowerCase().split(/[^a-z']+/).filter(w => w.length > 2);
    const wordFreq = {};
    for (const w of allWords) {
        wordFreq[w] = (wordFreq[w] || 0) + 1;
    }

    // Find characteristic words (appear in 20%+ of quotes)
    const threshold = Math.max(2, quotes.length * 0.2);
    const characteristicWords = Object.entries(wordFreq)
        .filter(([_, count]) => count >= threshold)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([word]) => word);

    // Detect patterns
    const patterns = {
        usesContractions: quotes.some(q => /\b(don't|won't|can't|shouldn't|wouldn't|I'm|I'll|he's|she's|they're|we're|it's)\b/.test(q)),
        usesSlang: quotes.some(q => /\b(gonna|wanna|gotta|ain't|y'all|kinda|sorta|lemme|dunno)\b/i.test(q)),
        usesExclamations: quotes.filter(q => /!/.test(q)).length / quotes.length,
        usesQuestions: quotes.filter(q => /\?/.test(q)).length / quotes.length,
        avgSentenceLength: avgLength,
        vocabularyLevel: avgLength > 15 ? 'complex' : avgLength > 10 ? 'moderate' : 'simple',
        toneIndicators: detectTone(quotes)
    };

    // Find repeated phrases or verbal tics
    const bigrams = {};
    for (const q of quotes) {
        const words = q.toLowerCase().split(/\s+/);
        for (let i = 0; i < words.length - 1; i++) {
            const bi = `${words[i]} ${words[i + 1]}`;
            bigrams[bi] = (bigrams[bi] || 0) + 1;
        }
    }

    const verbalTics = Object.entries(bigrams)
        .filter(([_, count]) => count >= 3)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([phrase]) => phrase);

    return {
        quoteCount: quotes.length,
        avgLength: Math.round(avgLength * 10) / 10,
        characteristicWords,
        verbalTics,
        patterns,
        sampleQuotes: quotes.slice(0, 5)
    };
}

/**
 * Detect emotional tone from quotes.
 */
function detectTone(quotes) {
    const tones = {
        aggressive: 0,
        gentle: 0,
        formal: 0,
        casual: 0,
        humorous: 0,
        serious: 0,
        philosophical: 0,
        emotional: 0
    };

    const indicators = {
        aggressive: /\b(fight|kill|destroy|hate|crush|break|smash|war|die|death|enemy)\b/i,
        gentle: /\b(please|thank|kind|hope|gentle|care|love|warm|peace|friend)\b/i,
        formal: /\b(indeed|however|therefore|perhaps|consequently|furthermore|shall|would you)\b/i,
        casual: /\b(hey|yeah|nah|cool|dude|man|like|whatever|chill|bro)\b/i,
        humorous: /\b(joke|funny|laugh|heh|haha|kidding|seriously\?|ridiculous)\b/i,
        serious: /\b(must|duty|honor|responsibility|oath|sworn|vow|protect|sacrifice)\b/i,
        philosophical: /\b(meaning|purpose|truth|wisdom|fate|destiny|believe|nature|existence)\b/i,
        emotional: /\b(feel|heart|soul|pain|tears|cry|miss|sorry|afraid|love)\b/i
    };

    for (const quote of quotes) {
        for (const [tone, pattern] of Object.entries(indicators)) {
            if (pattern.test(quote)) tones[tone]++;
        }
    }

    // Normalize and return top tones
    const total = Object.values(tones).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(tones)
        .map(([tone, count]) => ({ tone, strength: Math.round((count / total) * 100) }))
        .filter(t => t.strength > 10)
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 3);
}

/**
 * Generate a voice guide using LLM from quotes + analysis.
 */
export async function generateVoiceGuide(characterName, quoteAnalysis, additionalContext, context, settings) {
    const sampleQuotes = (quoteAnalysis?.sampleQuotes || []).map(q => `"${q}"`).join('\n');
    const tics = (quoteAnalysis?.verbalTics || []).join(', ');
    const charWords = (quoteAnalysis?.characteristicWords || []).join(', ');
    const patterns = quoteAnalysis?.patterns || {};
    const tones = (patterns.toneIndicators || []).map(t => `${t.tone} (${t.strength}%)`).join(', ');

    const prompt = `Create a character voice guide for writing dialogue as ${characterName} in roleplay.

QUOTE ANALYSIS:
- Average dialogue length: ${quoteAnalysis?.avgLength || 'unknown'} words
- Vocabulary level: ${patterns.vocabularyLevel || 'unknown'}
- Uses contractions: ${patterns.usesContractions ? 'yes' : 'no'}
- Uses slang: ${patterns.usesSlang ? 'yes' : 'no'}
- Exclamation frequency: ${Math.round((patterns.usesExclamations || 0) * 100)}%
- Tone: ${tones || 'unknown'}
- Verbal tics/repeated phrases: ${tics || 'none detected'}
- Characteristic words: ${charWords || 'none detected'}

SAMPLE QUOTES:
${sampleQuotes || 'No quotes available.'}

${additionalContext ? `ADDITIONAL CONTEXT:\n${additionalContext}\n` : ''}

Write a voice guide as a single paragraph (3-5 sentences) that would help an AI write dialogue as this character. Focus on:
1. HOW they construct sentences (length, complexity, fragments vs. flowing)
2. Their WORD CHOICES (crude vs. formal, specific vocabulary preferences)
3. Their EMOTIONAL EXPRESSION (restrained, explosive, sardonic, etc.)
4. Any VERBAL TICS or signature phrases
5. How they ADDRESS others (titles, nicknames, formal/informal)

The guide should be actionable — someone reading it should immediately understand this character's SOUND.
Output ONLY the voice guide paragraph, no headers or labels:`;

    try {
        const response = await callLLM(prompt, settings || {}, context);

        return response?.trim() || null;
    } catch (error) {
        console.error(`[CraftEngine] Voice guide generation failed for ${characterName}:`, error);
        return null;
    }
}

/**
 * Build a lorebook entry specifically for character voice.
 * These go at depth 1-2 for maximum impact on generation.
 */
export function buildVoiceEntry(characterName, voiceGuide, uid) {
    return {
        uid,
        key: [characterName],
        keysecondary: [],
        comment: `${characterName} — Voice Guide (Craft Engine)`,
        content: `[Roleplay Instruction — Voice of ${characterName}]\n${voiceGuide}`,
        constant: false,
        vectorized: false,
        selective: false,
        selectiveLogic: 0,
        addMemo: true,
        order: 500, // High priority
        position: 4, // at_depth
        disable: false,
        excludeRecursion: false,
        preventRecursion: false,
        delayUntilRecursion: false,
        probability: 100,
        useProbability: true,
        depth: 2, // Near generation point for maximum adherence
        group: `voice_${characterName.toLowerCase().replace(/\s+/g, '_')}`,
        groupOverride: false,
        groupWeight: 100,
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        useGroupScoring: null,
        automationId: '',
        role: null,
        sticky: 5, // Stay active for 5 messages after triggered
        cooldown: 0,
        delay: 0,
        displayIndex: uid
    };
}

/**
 * Full voice profiling pipeline for a character.
 * Combines quotes + wiki data + optional imported text.
 */
export async function profileCharacter(characterName, options, context, settings) {
    const {
        quotes = [],
        wikiPersonality = '',
        wikiSpeechPattern = '',
        importedDialogue = '',
        additionalContext = ''
    } = options;

    // Step 1: Analyze quotes
    const quoteAnalysis = analyzeQuotes(quotes);

    // Step 2: Build additional context from all sources
    let fullContext = '';
    if (wikiPersonality) fullContext += `Wiki personality: ${wikiPersonality}\n`;
    if (wikiSpeechPattern) fullContext += `Wiki speech pattern: ${wikiSpeechPattern}\n`;
    if (importedDialogue) fullContext += `Imported dialogue sample:\n${importedDialogue.substring(0, 1000)}\n`;
    if (additionalContext) fullContext += additionalContext;

    // Step 3: Generate voice guide via LLM
    const voiceGuide = await generateVoiceGuide(
        characterName,
        quoteAnalysis,
        fullContext,
        context,
        settings
    );

    return {
        characterName,
        quoteAnalysis,
        voiceGuide,
        // Build example dialogue format for character cards
        exampleDialogue: quotes.length > 0
            ? quotes.slice(0, 5).map(q => `{{char}}: "${q}"`).join('\n')
            : null
    };
}
