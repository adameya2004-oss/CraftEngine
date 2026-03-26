/**
 * Craft Engine — Baked-In Craft Rules from 22-Book Analysis
 * These are the empirically validated writing benchmarks that get injected
 * into the prompt (via generate_interceptor) and used for analysis scoring.
 */

// Sensory word lexicon for density counting
export const SENSORY_WORDS = {
    visual: new Set([
        'gleam', 'glint', 'shimmer', 'glow', 'flash', 'shadow', 'silhouette',
        'crimson', 'scarlet', 'pale', 'dark', 'bright', 'dim', 'flickering',
        'golden', 'silver', 'rust', 'amber', 'ivory', 'obsidian', 'copper',
        'blood-red', 'ink-black', 'white-hot', 'sun-bleached', 'weathered',
        'cracked', 'smooth', 'jagged', 'twisted', 'tangled', 'sprawling'
    ]),
    auditory: new Set([
        'crack', 'thud', 'clang', 'hiss', 'roar', 'whisper', 'rumble',
        'screech', 'groan', 'creak', 'snap', 'pop', 'sizzle', 'buzz',
        'clatter', 'rattle', 'thunder', 'echo', 'murmur', 'howl',
        'squelch', 'crunch', 'splash', 'drip', 'ring', 'chime', 'toll',
        'shriek', 'wail', 'moan', 'gasp', 'grunt', 'snarl', 'bark'
    ]),
    tactile: new Set([
        'rough', 'smooth', 'slick', 'sticky', 'cold', 'warm', 'hot',
        'burning', 'freezing', 'sharp', 'dull', 'soft', 'hard', 'wet',
        'dry', 'gritty', 'slimy', 'prickly', 'numb', 'tingling',
        'sting', 'ache', 'throb', 'pulse', 'pressure', 'weight',
        'calloused', 'tender', 'raw', 'bruised', 'swollen'
    ]),
    olfactory: new Set([
        'stink', 'stench', 'reek', 'perfume', 'aroma', 'scent', 'smell',
        'whiff', 'tang', 'musk', 'sweat', 'blood', 'smoke', 'ash',
        'rot', 'decay', 'damp', 'rain', 'earth', 'pine', 'salt',
        'copper', 'iron', 'leather', 'wood', 'dust', 'oil', 'gunpowder',
        'ink', 'soap', 'alcohol', 'char', 'sulfur', 'sweetness'
    ]),
    gustatory: new Set([
        'bitter', 'sweet', 'sour', 'salty', 'metallic', 'acidic',
        'savory', 'bland', 'spicy', 'tangy', 'rich', 'coppery',
        'bile', 'blood-taste', 'grit'
    ])
};

// All sensory words as a flat set for fast lookup
export const ALL_SENSORY = new Set(
    Object.values(SENSORY_WORDS).flatMap(s => [...s])
);

// Scene type detection patterns
export const SCENE_PATTERNS = {
    action: [
        /\b(sword|blade|fist|punch|kick|slash|stab|block|dodge|parry)\b/i,
        /\b(attack|defend|fight|battle|charge|retreat|advance)\b/i,
        /\b(blood|wound|pain|scream|impact|collision|explosion)\b/i,
        /\b(gun|shot|bullet|trigger|reload|aim|fire)\b/i,
        /\b(ran|sprinted|dove|ducked|rolled|jumped|leaped)\b/i
    ],
    romance: [
        /\b(kiss|lips|tongue|mouth|breath|skin|touch|caress)\b/i,
        /\b(heart|pulse|warmth|close|pressed|against|body)\b/i,
        /\b(desire|want|need|ache|longing|hunger)\b/i,
        /\b(bed|sheets|naked|undress|clothes|bare)\b/i
    ],
    dialogue: [
        /^"[^"]+"/m,
        /\b(said|asked|replied|muttered|whispered|shouted)\b/i
    ],
    opening: [
        // First ~200 chars of a response
    ]
};

// Benchmarks from 22-book analysis
export const BENCHMARKS = {
    action: {
        avgSentenceLength: { min: 10, target: 13, max: 16 },
        shortSentencePct: { min: 0.30, target: 0.40, max: 0.50 },
        sensoryDensity: { min: 0.7, target: 1.0, max: 1.5 },
        sentenceLengthStdev: { min: 7, target: 9, max: 12 }
    },
    romance: {
        avgSentenceLength: { min: 8, target: 12, max: 16 },
        shortSentencePct: { min: 0.30, target: 0.40, max: 0.55 },
        sensoryDensity: { min: 0.5, target: 0.8, max: 1.2 },
        sentenceLengthStdev: { min: 9, target: 13, max: 17 }
    },
    dialogue: {
        avgDialogueLength: { min: 7, target: 10, max: 14 },
        saidPct: { min: 0.50, target: 0.60, max: 0.72 }
    },
    opening: {
        sensoryWordsFirst200: { min: 8, target: 15, max: 30 }
    },
    general: {
        avgSentenceLength: { min: 12, target: 15, max: 20 },
        sentenceLengthStdev: { min: 10, target: 13, max: 17 },
        shortSentencePct: { min: 0.20, target: 0.30, max: 0.40 }
    }
};

// Style presets — named after the authors whose data produced them
export const STYLE_PRESETS = {
    'abercrombie-action': {
        name: 'Abercrombie Action',
        description: 'Cinematic action. Tight rhythm, high sensory density, punchy sentences.',
        benchmarks: {
            avgSentenceLength: 13,
            shortSentencePct: 0.38,
            sensoryDensity: 1.18,
            sentenceLengthStdev: 8.82
        },
        craftPrompt: `Write action with a tight, punchy rhythm. Average 12-13 words per sentence. 35-40% of sentences should be 8 words or fewer. Pack every sentence with tactile and auditory sensory detail — the reader should FEEL every impact. Compress sentences as intensity rises: long → medium → short → fragment at climax.`
    },
    'brown-staccato': {
        name: 'Pierce Brown Staccato',
        description: 'First-person present tense. Relentless forward momentum. Fragments as weapons.',
        benchmarks: {
            avgSentenceLength: 11,
            shortSentencePct: 0.45,
            sensoryDensity: 0.85,
            sentenceLengthStdev: 9.5
        },
        craftPrompt: `Write in rapid-fire staccato. First-person present tense. 45% short sentences. Fragments are weapons — use them at peak moments. Constant forward momentum. Never let the reader pause.`
    },
    'miller-literary': {
        name: 'Madeline Miller Literary',
        description: 'Flowing literary prose. High sensory immersion. Every touch described.',
        benchmarks: {
            avgSentenceLength: 16,
            shortSentencePct: 0.26,
            sensoryDensity: 0.90,
            sentenceLengthStdev: 9.87
        },
        craftPrompt: `Write with flowing, literary rhythm. Sustain sensory immersion — every physical detail lingers. 0.9+ sensory density. Sentences average 15-16 words. The prose should feel like poetry without becoming purple.`
    },
    'klune-heartbeat': {
        name: 'TJ Klune Heartbeat',
        description: 'Explicit/raw rhythm. Fragments stacking. Repetition as emotional engine.',
        benchmarks: {
            avgSentenceLength: 11.6,
            shortSentencePct: 0.52,
            sensoryDensity: 0.54,
            sentenceLengthStdev: 13.33
        },
        craftPrompt: `Write with a heartbeat rhythm. Over 50% short sentences. Use repetition deliberately — words as mantras, incantatory. Fragments stack for emotional impact. Raw, crude language. The rhythm does the emotional work, not purple description.`
    },
    'butcher-noir': {
        name: 'Jim Butcher Noir',
        description: 'Urban fantasy snark. Short punchy dialogue. Hardboiled voice.',
        benchmarks: {
            avgSentenceLength: 14,
            shortSentencePct: 0.30,
            sensoryDensity: 0.65,
            sentenceLengthStdev: 12.24
        },
        craftPrompt: `Write with hardboiled urban voice. Snappy dialogue averaging 10 words per line. First-person sarcasm. Action scenes are visceral but the narrator's voice never stops being a smartass. Dialogue tags lean aggressive: snarled, growled.`
    },
    'winn-devastation': {
        name: 'Alice Winn Devastation',
        description: 'Restrained prose that shatters. Massive rhythm swings. "Said" trusts the dialogue.',
        benchmarks: {
            avgSentenceLength: 15,
            shortSentencePct: 0.28,
            sensoryDensity: 0.55,
            sentenceLengthStdev: 16.95
        },
        craftPrompt: `Write with restraint. Long flowing passages that suddenly shatter into devastating short sentences. 78%+ "said" — trust dialogue to carry nuance. Short dialogue lines (7 words average). Characters who won't say what they feel, saying it anyway.`
    },
    'pacat-power': {
        name: 'CS Pacat Power Dynamics',
        description: 'Intimacy and political maneuvering are structurally identical. Tight chapters.',
        benchmarks: {
            avgSentenceLength: 14,
            shortSentencePct: 0.28,
            sensoryDensity: 0.63,
            sentenceLengthStdev: 13.67
        },
        craftPrompt: `Write where every interaction has a power dynamic subtext. Intimacy and strategy are structurally identical. Layer political maneuvering under every touch. Tight scene pacing — every word earns its place.`
    },
    'gemmell-combat': {
        name: 'David Gemmell Combat',
        description: 'Maximum sensory density in battle. Every blow connects physically.',
        benchmarks: {
            avgSentenceLength: 13,
            shortSentencePct: 0.35,
            sensoryDensity: 1.20,
            sentenceLengthStdev: 8.79
        },
        craftPrompt: `Write combat where every blow connects physically. Highest sensory density — the reader FEELS the impact. 35% short sentences in action. Tight rhythm variance. Tactile and auditory detail in every combat sentence.`
    },
    'canon-faithful': {
        name: 'Canon Faithful',
        description: 'Matches the source material voice. Uses imported lore and voice profiles.',
        benchmarks: null, // Uses dynamic benchmarks from voice profiles
        craftPrompt: `Match the canonical voice of the source material. Use the character voice profiles and lore entries loaded in the lorebook. Characters speak as they do in their original fiction — same vocabulary level, sentence patterns, verbal tics, and emotional range. World rules follow canon. Do not hallucinate lore.`
    }
};

/**
 * Resolve a preset by name — checks built-in presets first, then custom presets from settings.
 */
export function resolvePreset(presetName, customPresets) {
    if (STYLE_PRESETS[presetName]) return STYLE_PRESETS[presetName];
    if (presetName?.startsWith('custom_') && customPresets) {
        const idx = parseInt(presetName.replace('custom_', ''), 10);
        const custom = customPresets[idx];
        if (custom) {
            return {
                craftPrompt: custom.craftPrompt || custom.description || `Write in the style of ${custom.presetName || 'custom'}.`,
                benchmarks: custom.benchmarks || {}
            };
        }
    }
    return STYLE_PRESETS['abercrombie-action'];
}

// The master craft injection prompt — appended via generate_interceptor
export function buildCraftInjection(settings) {
    const preset = resolvePreset(settings.activePreset, settings.customPresets);
    const slopLevel = settings.slopDetection || 'moderate';

    let prompt = `[Craft Engine — Writing Quality Rules]\n`;
    prompt += preset.craftPrompt + '\n\n';

    // Slop avoidance
    if (slopLevel !== 'off') {
        prompt += `AVOID these overused phrases and clichés: `;
        const slopSample = [
            'breath hitched', 'shivers down spine', 'heart pounded',
            'obsidian eyes', 'piercing gaze', 'orbs', 'with practiced ease',
            'palpable tension', 'comfortable silence', 'weight of the world',
            'feral grin', 'wolfish grin', 'sardonic smile',
            'knees went weak', 'world seemed to stop'
        ];
        prompt += slopSample.join(', ') + '.\n';
        prompt += `Use specific, concrete descriptions instead of these generic patterns.\n\n`;
    }

    // Sentence variety
    prompt += `SENTENCE VARIETY: Never repeat the same sentence structure more than twice consecutively. `;
    prompt += `Vary sentence length dramatically — mix short punchy lines with flowing longer ones. `;
    prompt += `Never start 3+ consecutive sentences with the same word or pattern.\n\n`;

    // Sensory grounding
    prompt += `SENSORY GROUNDING: Include at least 3 different senses in every scene paragraph. `;
    prompt += `Prioritize smell (often forgotten), texture, and sound alongside visuals. `;
    prompt += `Use specific sensory comparisons, not abstractions.\n\n`;

    // Ending rules
    prompt += `ENDINGS: End on forward movement — a character actively DOING something. `;
    prompt += `Never end on questions, single-word fragments, ellipsis, or meta-commentary.\n`;

    // Custom rules from user
    if (settings.customRules && settings.customRules.trim()) {
        prompt += `\nADDITIONAL RULES: ${settings.customRules}\n`;
    }

    return prompt;
}

// Scene type detector
export function detectSceneType(text) {
    const scores = {};
    for (const [type, patterns] of Object.entries(SCENE_PATTERNS)) {
        if (type === 'opening') continue;
        scores[type] = patterns.reduce((count, regex) => {
            const matches = text.match(new RegExp(regex.source, 'gi'));
            return count + (matches ? matches.length : 0);
        }, 0);
    }

    const maxType = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    if (maxType && maxType[1] > 3) return maxType[0];
    return 'general';
}

// Get appropriate benchmarks for a scene type
export function getBenchmarks(sceneType, presetName) {
    const preset = STYLE_PRESETS[presetName];
    if (preset && preset.benchmarks) {
        return preset.benchmarks;
    }
    return BENCHMARKS[sceneType] || BENCHMARKS.general;
}
