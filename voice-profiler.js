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

Write a STRUCTURAL voice template that describes this character's speech PATTERNS, not example dialogue.

Format the template as a series of rules using structural notation:
- Sentence pattern: {emotion + action, X-Y words} or {dismissive acknowledgment, 1-3 words}
- Word choice: crude/formal/clinical/colloquial — list 5-8 SPECIFIC words this character would use
- Sentence length: typical range (e.g., 3-8 words for terse, 15-25 for verbose)
- Contractions: yes/no/sometimes
- Address style: how they refer to others (titles, surnames, nicknames, insults)
- Emotional tells: physical actions that reveal emotion (NOT "heart pounded" clichés — specific to THIS character)
- Verbal tics: repeated filler words, catchphrases, dialect markers
- What they NEVER say: patterns that would break character

The template should be 4-6 sentences of structural RULES, not example lines.
CRITICAL: Do NOT include example dialogue. Describe the PATTERN so the AI generates fresh dialogue that sounds right.
Output ONLY the voice template, no headers or labels:`;

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

    // Build diverse example dialogue — pick quotes that show different speech patterns
    const exampleDialogue = buildExampleDialogue(characterName, quotes, quoteAnalysis);

    return {
        characterName,
        quoteAnalysis,
        voiceGuide,
        exampleDialogue
    };
}

/**
 * Build diverse example dialogue lines from quotes.
 * Reddit consensus: 3-5 lines showing DIFFERENT situations beat 50 lines of the same vibe.
 * Picks quotes that vary in: length, tone, and word choice.
 */
export function buildExampleDialogue(characterName, quotes, quoteAnalysis) {
    if (!quotes || quotes.length < 3) return null;

    // Score each quote for diversity
    const scored = quotes.map((q, i) => {
        const words = q.split(/\s+/).length;
        const hasQuestion = /\?/.test(q);
        const hasExclamation = /!/.test(q);
        const hasContraction = /\w'\w/.test(q);
        const hasSlang = /\b(yeah|nah|gonna|wanna|gotta|ain't|y'all|dunno|kinda|sorta)\b/i.test(q);
        const isShort = words <= 6;
        const isLong = words >= 15;
        return { quote: q, index: i, words, hasQuestion, hasExclamation, hasContraction, hasSlang, isShort, isLong };
    });

    // Pick diverse set: one short, one long, one question, one statement, one emotional
    const picked = [];
    const used = new Set();

    const pickOne = (filter, label) => {
        const candidates = scored.filter((s, i) => filter(s) && !used.has(i));
        if (candidates.length > 0) {
            const pick = candidates[Math.floor(Math.random() * candidates.length)];
            picked.push(pick);
            used.add(pick.index);
        }
    };

    pickOne(s => s.isShort, 'short');
    pickOne(s => s.isLong, 'long');
    pickOne(s => s.hasQuestion, 'question');
    pickOne(s => s.hasExclamation, 'exclamation');
    pickOne(s => s.hasSlang || s.hasContraction, 'casual');

    // Fill remaining slots (up to 5) with random unselected quotes
    while (picked.length < 5 && picked.length < quotes.length) {
        const remaining = scored.filter(s => !used.has(s.index));
        if (remaining.length === 0) break;
        const pick = remaining[Math.floor(Math.random() * remaining.length)];
        picked.push(pick);
        used.add(pick.index);
    }

    // Format as ST example dialogue
    return picked.map(p => `{{char}}: "${p.quote}"`).join('\n');
}
