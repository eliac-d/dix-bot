import { promises as fs } from 'fs';
import path from 'path';

export const FILE_PATH = path.resolve(process.cwd(), 'database', 'characters.json');
export const rollLocks = new Map();

export function cleanOldLocks() {
    const now = Date.now();
    for (const [userId, lockTime] of rollLocks.entries()) {
        if (now - lockTime > 30000) rollLocks.delete(userId);
    }
}

export function getUserById(id) {
    if (!global.User || !global.User._engine) return null;
    return global.User._engine._findOneSync({ id });
}

export async function loadCharacters() {
    const dir = path.dirname(FILE_PATH);
    try { await fs.mkdir(dir, { recursive: true }); } catch {}
    try { await fs.access(FILE_PATH); } catch { await fs.writeFile(FILE_PATH, '{}'); }
    const raw = await fs.readFile(FILE_PATH, 'utf-8');
    return JSON.parse(raw);
}

export function flattenCharacters(chars) {
    return Object.values(chars).flatMap(s => Array.isArray(s.characters) ? s.characters : []);
}

export function getSeriesNameByCharacter(chars, id) {
    return Object.entries(chars).find(([, serie]) => Array.isArray(serie.characters) && serie.characters.some(c => String(c.id) === String(id)))?.[1]?.name || 'Desconocido';
}

export function getCharacterById(id, structure) {
    return Object.values(structure).flatMap(s => Array.isArray(s.characters) ? s.characters : []).find(c => String(c.id) === String(id));
}

export function formatTag(tag) {
    return String(tag).trim().toLowerCase().replace(/\s+/g, '_');
}

export function getRefererForUrl(url) {
    if (url.includes('safebooru.org')) return 'https://safebooru.org/';
    if (url.includes('danbooru.donmai.us')) return 'https://danbooru.donmai.us/';
    if (url.includes('gelbooru.com')) return 'https://gelbooru.com/';
    return '';
}

export async function buscarImagenDelirius(tag) {
    const query = formatTag(tag);
    const urls = [
        `https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&tags=${query}`,
        `https://danbooru.donmai.us/posts.json?tags=${query}`,
        `https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&tags=${query}&api_key=98f554258c88c44f4dd28ccde0c28f36682b2a992490ab35ebcc7baf7e196a86d7550b174bce577b8cc3f544e9b3ad0f6aeb09ad63bf89a9141cc3eddb6fbfd2&user_id=1917269`
    ];
    for (const url of urls) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
            const type = res.headers.get('content-type') || '';
            if (!res.ok || !type.includes('json')) continue;
            const json = await res.json();
            const data = Array.isArray(json) ? json : json?.post || json?.data || [];
            const valid = data.map(i => i?.file_url || i?.large_file_url || i?.image || i?.media_asset?.variants?.[0]?.url).filter(u => typeof u === 'string' && /\.(jpe?g|png)$/.test(u));
            if (valid.length) return valid;
        } catch {}
    }
    return [];
}