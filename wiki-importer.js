/**
 * Craft Engine — Wiki Importer
 * Scrapes Fandom/MediaWiki wikis and converts them into SillyTavern lorebook entries.
 * Pipeline: Discovery → Fetch → Parse → Classify → Condense → Voice → Structure → Export
 */

import { callLLM } from './api-client.js';

// ─── MediaWiki API Client ───────────────────────────────────────────

const API_DELAY = 1500; // ms between requests to avoid rate limits
const BATCH_SIZE = 50;  // MediaWiki max titles per query

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getApiUrl(wikiUrl) {
    // Convert any fandom URL to the API endpoint
    // Input: https://naruto.fandom.com/wiki/Naruto_Uzumaki
    // Output: https://naruto.fandom.com/api.php
    const url = new URL(wikiUrl);
    return `${url.origin}/api.php`;
}

function getWikiBase(wikiUrl) {
    const url = new URL(wikiUrl);
    return url.origin;
}

/**
 * Query the MediaWiki API.
 */
async function wikiApi(apiUrl, params) {
    const searchParams = new URLSearchParams({ format: 'json', ...params });
    const url = `${apiUrl}?${searchParams.toString()}`;

    const response = await fetch(url, {
        headers: {
            'User-Agent': 'CraftEngine/1.0 (SillyTavern Extension; lorebook import)',
            'Accept': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(`Wiki API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
}

// ─── Discovery: Find Pages ──────────────────────────────────────────

/**
 * List all pages in a category.
 * Returns array of { title, pageid }.
 */
export async function listCategoryPages(wikiUrl, categoryName, limit = 200) {
    const apiUrl = getApiUrl(wikiUrl);
    const pages = [];
    let cmcontinue = null;

    // Normalize category name
    if (!categoryName.startsWith('Category:')) {
        categoryName = `Category:${categoryName}`;
    }

    do {
        const params = {
            action: 'query',
            list: 'categorymembers',
            cmtitle: categoryName,
            cmlimit: Math.min(limit - pages.length, 500),
            cmtype: 'page'
        };
        if (cmcontinue) params.cmcontinue = cmcontinue;

        const data = await wikiApi(apiUrl, params);

        if (data.query && data.query.categorymembers) {
            pages.push(...data.query.categorymembers.map(p => ({
                title: p.title,
                pageid: p.pageid
            })));
        }

        cmcontinue = data.continue ? data.continue.cmcontinue : null;
        if (pages.length >= limit) break;

        await sleep(API_DELAY);
    } while (cmcontinue);

    return pages;
}

/**
 * Search wiki pages by keyword.
 */
export async function searchPages(wikiUrl, query, limit = 50) {
    const apiUrl = getApiUrl(wikiUrl);
    const data = await wikiApi(apiUrl, {
        action: 'query',
        list: 'search',
        srsearch: query,
        srlimit: limit
    });

    return (data.query?.search || []).map(p => ({
        title: p.title,
        pageid: p.pageid,
        snippet: p.snippet?.replace(/<[^>]+>/g, '')
    }));
}

/**
 * List all categories on a wiki (for discovery UI).
 */
export async function listCategories(wikiUrl, prefix = '', limit = 100) {
    const apiUrl = getApiUrl(wikiUrl);
    const data = await wikiApi(apiUrl, {
        action: 'query',
        list: 'allcategories',
        acprefix: prefix,
        aclimit: limit
    });

    return (data.query?.allcategories || []).map(c => c['*']);
}

// ─── Fetch: Get Page Content ────────────────────────────────────────

/**
 * Fetch wikitext content for multiple pages.
 */
export async function fetchPages(wikiUrl, titles) {
    const apiUrl = getApiUrl(wikiUrl);
    const results = [];

    // Batch in groups of 50
    for (let i = 0; i < titles.length; i += BATCH_SIZE) {
        const batch = titles.slice(i, i + BATCH_SIZE);
        const data = await wikiApi(apiUrl, {
            action: 'query',
            titles: batch.join('|'),
            prop: 'revisions',
            rvprop: 'content',
            rvslots: 'main'
        });

        if (data.query?.pages) {
            for (const page of Object.values(data.query.pages)) {
                if (page.revisions && page.revisions[0]) {
                    const content = page.revisions[0].slots?.main?.['*'] || page.revisions[0]['*'] || '';
                    results.push({
                        title: page.title,
                        pageid: page.pageid,
                        wikitext: content
                    });
                }
            }
        }

        if (i + BATCH_SIZE < titles.length) await sleep(API_DELAY);
    }

    return results;
}

/**
 * Fetch parsed HTML for a single page.
 */
export async function fetchParsedPage(wikiUrl, title) {
    const apiUrl = getApiUrl(wikiUrl);
    const data = await wikiApi(apiUrl, {
        action: 'parse',
        page: title,
        prop: 'text|categories|links'
    });

    if (data.parse) {
        return {
            title: data.parse.title,
            html: data.parse.text?.['*'] || '',
            categories: (data.parse.categories || []).map(c => c['*']),
            links: (data.parse.links || []).map(l => l['*'])
        };
    }

    return null;
}

/**
 * Try to fetch a character's quotes page.
 */
export async function fetchQuotes(wikiUrl, characterName) {
    const apiUrl = getApiUrl(wikiUrl);
    const quotesTitle = `${characterName}/Quotes`;

    try {
        const data = await wikiApi(apiUrl, {
            action: 'query',
            titles: quotesTitle,
            prop: 'revisions',
            rvprop: 'content',
            rvslots: 'main'
        });

        if (data.query?.pages) {
            const page = Object.values(data.query.pages)[0];
            if (page.pageid && page.revisions) {
                const content = page.revisions[0].slots?.main?.['*'] || page.revisions[0]['*'] || '';
                return parseQuotes(content);
            }
        }
    } catch (e) {
        // Quotes page doesn't exist — that's fine
    }

    return [];
}

// ─── Parse: Extract Structured Data ─────────────────────────────────

/**
 * Parse wikitext infobox into structured fields.
 */
export function parseInfobox(wikitext) {
    // Match {{Infobox ...}} or {{Character ...}} templates
    const infoboxRegex = /\{\{(?:Infobox|Character|Individual|Person|Bio|Charbox)[^}]*\|([^{}]*(?:\{\{[^{}]*\}\}[^{}]*)*)\}\}/is;
    const match = wikitext.match(infoboxRegex);

    if (!match) return null;

    const fields = {};
    const content = match[1];

    // Parse pipe-separated fields
    const fieldRegex = /\|\s*(\w[\w\s]*?)\s*=\s*([^|]*?)(?=\n\s*\||$)/gs;
    let fieldMatch;

    while ((fieldMatch = fieldRegex.exec(content)) !== null) {
        const key = fieldMatch[1].trim().toLowerCase();
        let value = fieldMatch[2].trim();

        // Clean wiki markup from values
        value = cleanWikiMarkup(value);

        if (value && value !== 'N/A' && value !== 'Unknown') {
            fields[key] = value;
        }
    }

    return Object.keys(fields).length > 0 ? fields : null;
}

/**
 * Parse wikitext into sections.
 */
export function parseSections(wikitext) {
    const sections = [];
    const sectionRegex = /^(={2,})\s*(.+?)\s*\1/gm;
    let lastIndex = 0;
    let lastTitle = 'Introduction';
    let lastLevel = 0;
    let match;

    while ((match = sectionRegex.exec(wikitext)) !== null) {
        const content = wikitext.substring(lastIndex, match.index).trim();
        if (content) {
            sections.push({
                title: lastTitle,
                level: lastLevel,
                content: cleanWikiMarkup(content)
            });
        }

        lastTitle = match[2];
        lastLevel = match[1].length;
        lastIndex = match.index + match[0].length;
    }

    // Final section
    const remaining = wikitext.substring(lastIndex).trim();
    if (remaining) {
        sections.push({
            title: lastTitle,
            level: lastLevel,
            content: cleanWikiMarkup(remaining)
        });
    }

    return sections;
}

/**
 * Extract internal wiki links (relationships, related pages).
 */
export function extractLinks(wikitext) {
    const linkRegex = /\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g;
    const links = [];
    let match;

    while ((match = linkRegex.exec(wikitext)) !== null) {
        const target = match[1].trim();
        const display = match[2]?.trim() || target;

        // Skip file/image links, categories, and templates
        if (!target.match(/^(File|Image|Category|Template|Special):/i)) {
            links.push({ target, display });
        }
    }

    return links;
}

/**
 * Parse a quotes page into individual quotes.
 */
function parseQuotes(wikitext) {
    const quotes = [];
    // Common quote formats: * "text" or : "text" or {{quote|text}}
    const quoteRegex = /(?:\*|:)\s*[""\u201C]([^""\u201D]+)[""\u201D]/g;
    let match;

    while ((match = quoteRegex.exec(wikitext)) !== null) {
        const quote = match[1].trim();
        if (quote.length > 10 && quote.length < 500) {
            quotes.push(quote);
        }
    }

    // Also try {{quote}} templates
    const templateRegex = /\{\{[Qq]uote\|([^|}]+)/g;
    while ((match = templateRegex.exec(wikitext)) !== null) {
        const quote = match[1].trim();
        if (quote.length > 10 && quote.length < 500) {
            quotes.push(quote);
        }
    }

    return [...new Set(quotes)]; // Deduplicate
}

/**
 * Clean wiki markup from text.
 */
function cleanWikiMarkup(text) {
    return text
        .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')  // [[link|display]] → display
        .replace(/\{\{[^}]+\}\}/g, '')                        // Remove templates
        .replace(/<ref[^>]*>.*?<\/ref>/gs, '')                 // Remove references
        .replace(/<ref[^/]*\/>/g, '')                          // Remove self-closing refs
        .replace(/<\/?[^>]+>/g, '')                            // Remove HTML tags
        .replace(/'{2,3}/g, '')                                // Remove bold/italic wiki markup
        .replace(/\n{3,}/g, '\n\n')                            // Collapse excessive newlines
        .trim();
}

// ─── Classify: Determine Page Type ──────────────────────────────────

/**
 * Classify a wiki page by type based on categories and content.
 */
export function classifyPage(title, categories, infobox, sections) {
    const catString = (categories || []).join(' ').toLowerCase();
    const sectionTitles = (sections || []).map(s => s.title.toLowerCase());

    // Character indicators
    if (catString.match(/character|person|individual|protagonist|antagonist|villain|hero/) ||
        sectionTitles.some(s => s.match(/personality|appearance|abilities|relationships|biography/)) ||
        (infobox && (infobox.species || infobox.race || infobox.affiliation || infobox.occupation))) {
        return 'character';
    }

    // Location indicators
    if (catString.match(/location|place|city|country|region|world|realm|planet/) ||
        sectionTitles.some(s => s.match(/geography|climate|population|landmarks/)) ||
        (infobox && (infobox.location || infobox.population || infobox.region))) {
        return 'location';
    }

    // Faction/Organization
    if (catString.match(/faction|organization|group|team|clan|guild|order/) ||
        sectionTitles.some(s => s.match(/members|hierarchy|structure|goals/))) {
        return 'faction';
    }

    // Lore system (magic, technology, etc.)
    if (catString.match(/magic|ability|power|skill|technique|system|technology/) ||
        sectionTitles.some(s => s.match(/usage|types|classification|rules|mechanics/))) {
        return 'lore_system';
    }

    // Item/Weapon/Artifact
    if (catString.match(/item|weapon|artifact|equipment|tool/) ||
        (infobox && (infobox.type || infobox.power || infobox.wielder))) {
        return 'item';
    }

    // Event/Battle
    if (catString.match(/event|battle|war|conflict|incident/) ||
        sectionTitles.some(s => s.match(/combatants|outcome|aftermath|casualties/))) {
        return 'event';
    }

    return 'general';
}

// ─── Condense: LLM-Powered Summarization ────────────────────────────

/**
 * Build a condensation prompt for a specific page type.
 */
function buildCondensationPrompt(pageData, pageType) {
    const { title, infobox, sections } = pageData;

    const sectionText = sections
        .filter(s => s.content.length > 50)
        .map(s => `### ${s.title}\n${s.content.substring(0, 1500)}`)
        .join('\n\n');

    const infoboxText = infobox
        ? Object.entries(infobox).map(([k, v]) => `${k}: ${v}`).join('\n')
        : 'No infobox found.';

    const prompts = {
        character: `Extract a lorebook entry for the character "${title}" from this wiki data.

INFOBOX DATA:
${infoboxText}

PAGE SECTIONS:
${sectionText}

Output a JSON object with these fields:
{
  "name": "character's full name",
  "aliases": ["list of nicknames, titles, alternative names"],
  "appearance": "2-3 sentences describing physical appearance — hair, build, distinguishing features, typical clothing",
  "personality": "3-4 sentences describing core personality traits through BEHAVIORS, not just adjective lists. Show HOW traits manifest.",
  "abilities": "2-3 sentences listing key abilities/skills with brief descriptions",
  "relationships": [{"name": "person", "type": "ally/enemy/family/romantic", "description": "1 sentence"}],
  "background": "2-3 sentences of essential backstory that defines current state",
  "speechPattern": "1-2 sentences describing how they talk — vocabulary level, verbal tics, catchphrases, formality",
  "motivation": "1 sentence: what drives this character RIGHT NOW",
  "status": "current status (alive/dead/unknown, current role/position)"
}

Be concise. A lorebook entry should be 150-300 words total. Focus on what matters for roleplay: personality, voice, relationships, motivations. Skip minor plot details.`,

        location: `Extract a lorebook entry for the location "${title}" from this wiki data.

INFOBOX DATA:
${infoboxText}

PAGE SECTIONS:
${sectionText}

Output a JSON object:
{
  "name": "location name",
  "aliases": ["alternative names"],
  "description": "2-3 sentences describing what this place looks and feels like — architecture, atmosphere, sensory details",
  "significance": "1-2 sentences: why this place matters in the story/world",
  "notableResidents": ["list of important characters associated with this location"],
  "rules": "any special rules or laws that apply here (magic restrictions, social norms, etc.)",
  "geography": "1 sentence: where this is relative to other known locations"
}`,

        faction: `Extract a lorebook entry for the faction/organization "${title}" from this wiki data.

INFOBOX DATA:
${infoboxText}

PAGE SECTIONS:
${sectionText}

Output a JSON object:
{
  "name": "faction name",
  "aliases": ["alternative names"],
  "description": "2-3 sentences describing what this group is and what they do",
  "philosophy": "1-2 sentences: their core beliefs, goals, or ideology",
  "structure": "1 sentence: how they're organized (hierarchy, ranks, leadership)",
  "notableMembers": ["list of key members"],
  "relations": [{"faction": "name", "type": "ally/enemy/neutral", "description": "1 sentence"}]
}`,

        lore_system: `Extract a lorebook entry for the lore system "${title}" from this wiki data.

INFOBOX DATA:
${infoboxText}

PAGE SECTIONS:
${sectionText}

Output a JSON object:
{
  "name": "system name",
  "aliases": ["alternative names"],
  "description": "2-3 sentences explaining what this system is and how it works",
  "rules": ["list of key rules or constraints — what CAN and CANNOT be done"],
  "types": ["list of subtypes or classifications if applicable"],
  "users": "who can use this system and what determines ability"
}`,

        item: `Extract a lorebook entry for the item "${title}" from this wiki data.

INFOBOX DATA:
${infoboxText}

PAGE SECTIONS:
${sectionText}

Output a JSON object:
{
  "name": "item name",
  "aliases": ["alternative names"],
  "description": "1-2 sentences describing appearance and properties",
  "abilities": "what it does — powers, effects, capabilities",
  "history": "1 sentence of relevant history",
  "currentHolder": "who has it now (if known)"
}`,

        general: `Extract a lorebook entry for "${title}" from this wiki data.

INFOBOX DATA:
${infoboxText}

PAGE SECTIONS:
${sectionText}

Output a JSON object:
{
  "name": "entry name",
  "aliases": ["alternative names"],
  "description": "3-5 sentences summarizing the most important information for roleplay purposes",
  "relevance": "1 sentence: why this matters in the world"
}`,

        event: `Extract a lorebook entry for the event "${title}" from this wiki data.

INFOBOX DATA:
${infoboxText}

PAGE SECTIONS:
${sectionText}

Output a JSON object:
{
  "name": "event name",
  "aliases": ["alternative names"],
  "description": "2-3 sentences describing what happened",
  "participants": ["key participants"],
  "outcome": "1-2 sentences: the result and lasting impact",
  "date": "when it happened (in-universe timeline)"
}`
    };

    return prompts[pageType] || prompts.general;
}

/**
 * Condense a page using the LLM.
 * Returns structured JSON data.
 */
export async function condensePage(pageData, pageType, context, settings) {
    const prompt = buildCondensationPrompt(pageData, pageType);

    try {
        const response = await callLLM(prompt, settings || {}, context);

        // Try to parse as JSON
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch (parseError) {
            console.warn('[CraftEngine] JSON parse failed, using raw text:', parseError);
        }

        // Fallback: return as raw description
        return { name: pageData.title, description: response, raw: true };
    } catch (error) {
        console.error(`[CraftEngine] Condense failed for ${pageData.title}:`, error);
        return null;
    }
}

// ─── Structure: Build Lorebook Entries ──────────────────────────────

/**
 * Convert condensed page data into a SillyTavern lorebook entry.
 */
export function buildLorebookEntry(condensed, pageType, uid, settings = {}) {
    if (!condensed) return null;

    const depth = settings.depth || 4;
    const position = settings.position || 4; // at_depth

    // Build activation keywords
    const keys = [condensed.name];
    if (condensed.aliases) {
        keys.push(...condensed.aliases);
    }

    // Build content based on page type
    let content = '';

    switch (pageType) {
        case 'character': {
            content = `[${condensed.name}`;
            if (condensed.appearance) content += `: ${condensed.appearance}`;
            content += `]\n`;
            if (condensed.personality) content += `Personality: ${condensed.personality}\n`;
            if (condensed.abilities) content += `Abilities: ${condensed.abilities}\n`;
            if (condensed.speechPattern) content += `Speech: ${condensed.speechPattern}\n`;
            if (condensed.motivation) content += `Motivation: ${condensed.motivation}\n`;
            if (condensed.status) content += `Status: ${condensed.status}\n`;
            if (condensed.background) content += `Background: ${condensed.background}\n`;
            if (condensed.relationships && condensed.relationships.length > 0) {
                content += `Relationships: ${condensed.relationships.map(r =>
                    `${r.name} (${r.type}): ${r.description}`
                ).join('; ')}\n`;
            }
            break;
        }
        case 'location': {
            content = `[Location: ${condensed.name}]\n`;
            if (condensed.description) content += `${condensed.description}\n`;
            if (condensed.significance) content += `Significance: ${condensed.significance}\n`;
            if (condensed.rules) content += `Rules: ${condensed.rules}\n`;
            if (condensed.geography) content += `Geography: ${condensed.geography}\n`;
            if (condensed.notableResidents?.length) {
                content += `Notable residents: ${condensed.notableResidents.join(', ')}\n`;
            }
            break;
        }
        case 'faction': {
            content = `[Faction: ${condensed.name}]\n`;
            if (condensed.description) content += `${condensed.description}\n`;
            if (condensed.philosophy) content += `Philosophy: ${condensed.philosophy}\n`;
            if (condensed.structure) content += `Structure: ${condensed.structure}\n`;
            if (condensed.notableMembers?.length) {
                content += `Key members: ${condensed.notableMembers.join(', ')}\n`;
            }
            break;
        }
        case 'lore_system': {
            content = `[Lore: ${condensed.name}]\n`;
            if (condensed.description) content += `${condensed.description}\n`;
            if (condensed.rules?.length) {
                content += `Rules: ${condensed.rules.join('. ')}\n`;
            }
            if (condensed.types?.length) {
                content += `Types: ${condensed.types.join(', ')}\n`;
            }
            if (condensed.users) content += `Users: ${condensed.users}\n`;
            break;
        }
        default: {
            content = `[${condensed.name}]\n`;
            if (condensed.description) content += `${condensed.description}\n`;
            if (condensed.relevance) content += `Relevance: ${condensed.relevance}\n`;
        }
    }

    return {
        uid,
        key: keys,
        keysecondary: [],
        comment: `${condensed.name} — ${pageType}`,
        content: content.trim(),
        constant: false,
        vectorized: false,
        selective: false,
        selectiveLogic: 0,
        addMemo: true,
        order: pageType === 'character' ? 200 : pageType === 'location' ? 150 : 100,
        position,
        disable: false,
        excludeRecursion: false,
        preventRecursion: false,
        delayUntilRecursion: false,
        probability: 100,
        useProbability: true,
        depth,
        group: '',
        groupOverride: false,
        groupWeight: 100,
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        useGroupScoring: null,
        automationId: '',
        role: null,
        sticky: pageType === 'character' ? 3 : 0, // Characters stay active for 3 messages
        cooldown: 0,
        delay: 0,
        displayIndex: uid
    };
}

/**
 * Build a complete lorebook from multiple entries.
 */
export function buildLorebook(entries, name, description) {
    const entriesObj = {};
    for (const entry of entries) {
        if (entry) {
            entriesObj[entry.uid.toString()] = entry;
        }
    }

    return {
        entries: entriesObj,
        originalData: {
            name: name || 'Craft Engine Import',
            description: description || 'Generated by Craft Engine wiki importer',
            scanDepth: 2,
            tokenBudget: 2048,
            recursiveScanning: true,
            caseSensitive: false,
            matchWholeWords: true
        }
    };
}

// ─── Master Import Pipeline ─────────────────────────────────────────

/**
 * Full import pipeline: URL → Lorebook
 * Emits progress events for the UI.
 */
export async function importFromWiki(wikiUrl, options, context, onProgress) {
    const {
        categoryName = null,
        searchQuery = null,
        pageLimit = 50,
        includeQuotes = true,
        depth = 4,
        selectedPages = null // If provided, skip discovery and use these titles
    } = options;

    const progress = (step, detail, pct) => {
        if (onProgress) onProgress({ step, detail, pct });
    };

    try {
        // Step 1: Discovery
        progress('discovery', 'Finding pages...', 5);
        let pages;

        if (selectedPages) {
            pages = selectedPages.map(title => ({ title, pageid: 0 }));
        } else if (categoryName) {
            pages = await listCategoryPages(wikiUrl, categoryName, pageLimit);
        } else if (searchQuery) {
            pages = await searchPages(wikiUrl, searchQuery, pageLimit);
        } else {
            throw new Error('Provide a category name, search query, or selected pages.');
        }

        progress('discovery', `Found ${pages.length} pages`, 10);

        // Step 2: Fetch
        progress('fetch', 'Downloading page content...', 15);
        const titles = pages.map(p => p.title);
        const fetchedPages = await fetchPages(wikiUrl, titles);
        progress('fetch', `Downloaded ${fetchedPages.length} pages`, 30);

        // Step 3: Parse + Classify
        progress('parse', 'Parsing wiki content...', 35);
        const parsedPages = [];

        for (const page of fetchedPages) {
            const infobox = parseInfobox(page.wikitext);
            const sections = parseSections(page.wikitext);
            const links = extractLinks(page.wikitext);
            const categories = []; // Would need a separate API call; classify from content instead

            const pageType = classifyPage(page.title, categories, infobox, sections);

            parsedPages.push({
                title: page.title,
                infobox,
                sections,
                links,
                pageType,
                wikitext: page.wikitext
            });
        }

        progress('parse', `Parsed ${parsedPages.length} pages`, 45);

        // Step 4: Condense (LLM calls)
        progress('condense', 'Condensing with LLM...', 50);
        const condensedPages = [];

        for (let i = 0; i < parsedPages.length; i++) {
            const page = parsedPages[i];
            progress('condense', `Condensing: ${page.title} (${i + 1}/${parsedPages.length})`,
                50 + (i / parsedPages.length) * 30);

            const condensed = await condensePage(page, page.pageType, context, settings);

            if (condensed) {
                condensedPages.push({ ...condensed, pageType: page.pageType, title: page.title });
            }

            await sleep(500); // Brief pause between LLM calls
        }

        progress('condense', `Condensed ${condensedPages.length} pages`, 80);

        // Step 5: Voice extraction (optional)
        if (includeQuotes) {
            progress('voice', 'Extracting character quotes...', 82);
            const characters = condensedPages.filter(p => p.pageType === 'character');

            for (const char of characters) {
                const quotes = await fetchQuotes(wikiUrl, char.title);
                if (quotes.length > 0) {
                    char.quotes = quotes.slice(0, 20); // Cap at 20 quotes
                }
                await sleep(API_DELAY);
            }

            progress('voice', `Extracted quotes for ${characters.length} characters`, 88);
        }

        // Step 6: Build lorebook entries
        progress('structure', 'Building lorebook...', 90);
        const entries = condensedPages.map((page, idx) =>
            buildLorebookEntry(page, page.pageType, idx, { depth })
        ).filter(Boolean);

        // Step 7: Assemble lorebook
        const lorebookName = `${new URL(wikiUrl).hostname.split('.')[0]} Lore`;
        const lorebook = buildLorebook(entries, lorebookName, `Imported from ${wikiUrl}`);

        progress('complete', `Done! ${entries.length} lorebook entries created.`, 100);

        return {
            lorebook,
            stats: {
                pagesFound: pages.length,
                pagesFetched: fetchedPages.length,
                entriesCreated: entries.length,
                pageTypes: condensedPages.reduce((acc, p) => {
                    acc[p.pageType] = (acc[p.pageType] || 0) + 1;
                    return acc;
                }, {}),
                charactersWithQuotes: condensedPages.filter(p => p.quotes?.length > 0).length
            },
            condensedPages // Return raw data too for voice profiling
        };
    } catch (error) {
        progress('error', error.message, -1);
        throw error;
    }
}
