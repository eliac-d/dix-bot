import { jidNormalizedUser } from '@whiskeysockets/baileys';
import axios from 'axios';
import { promises as fs, readFileSync } from 'fs';
import path from 'path';
import FormData from 'form-data';

const defaultChannel = '120363406846602793@newsletter';
const DEFAULT_STYLE_MARKER = 'default';

global.customBotConfigs = global.customBotConfigs || new Map();

global.surl = (c) => {
    const key = formatJid(typeof c !== 'undefined' ? c : global.conn);
    const custom = global.customBotConfigs.get(key);
    return custom?.url || 'https://dix.lat/s/channel';
};

global.botStylesMap = global.botStylesMap || new Map();
global.botNames = global.botNames || [];
global.botImages = global.botImages || [];

const formatJid = (jid) => {
    if (!jid) return '';
    let rawJid = jid;
    if (typeof jid === 'object') {
        rawJid = jid?.user?.id || jid?.user?.jid || jid?.id || '';
    }
    if (typeof rawJid !== 'string') return '';
    const clean = rawJid.split('@')[0].split(':')[0];
    return `${clean}@s.whatsapp.net`;
};

const stylesPath = path.join(process.cwd(), 'src', 'bot_styles.json');

export function loadAllStyles() {
    try {
        const rawData = readFileSync(stylesPath, 'utf-8');
        const styles = JSON.parse(rawData);

        global.botStylesMap.clear();
        global.customBotConfigs.clear();
        global.botNames = [];
        global.botImages = [];

        
        let defaultStyle = null;
        for (const key of Object.keys(styles)) {
            if (key.startsWith('custom_')) continue;
            const style = styles[key];
            if (Array.isArray(style.ids) && style.ids.includes(DEFAULT_STYLE_MARKER)) {
                defaultStyle = style;
                break;
            }
        }

        
        if (defaultStyle) {
            global.botNames = Array.isArray(defaultStyle.botNames) ? defaultStyle.botNames : [];
            global.botImages = Array.isArray(defaultStyle.botImages) ? defaultStyle.botImages : [];
        } else {
            console.warn("[bot_styles] No se encontró un estilo con ids: [\"default\"] en el JSON.");
        }

        
        for (const key of Object.keys(styles)) {
            const style = styles[key];

            if (key.startsWith('custom_')) {
                const targetJid = key.replace('custom_', '');
                global.customBotConfigs.set(targetJid, {
                    name: style.botNames?.[0] || null,
                    images: Array.isArray(style.botImages) && style.botImages.length > 0 ? style.botImages : null,
                    channelJid: style.channelJid || defaultChannel,
                    url: style.url || 'https://dix.lat/s/channel'
                });
                continue;
            }

            const names = style.botNames && style.botNames.length ? style.botNames : global.botNames;
            const images = style.botImages && style.botImages.length ? style.botImages : global.botImages;

            if (Array.isArray(style.ids)) {
                for (const id of style.ids) {
                    if (id === DEFAULT_STYLE_MARKER) continue; 
                    const clean = formatJid(id);
                    if (clean) {
                        global.botStylesMap.set(clean, { names, images });
                    }
                }
            }
        }
    } catch (e) {
        console.error("Error al cargar todos los estilos:", e);
    }
}

loadAllStyles();

global.name = (botJid) => {
    const key = formatJid(botJid);
    const custom = global.customBotConfigs.get(key);
    if (custom && custom.name) return custom.name;

    const config = global.botStylesMap.get(key);
    const list = (config && config.names && config.names.length)
        ? config.names
        : (global.botNames || []);

    if (!list.length) return 'Bot';
    return list[Math.floor(Math.random() * list.length)];
};

global.img = (botJid) => {
    const key = formatJid(botJid);
    const custom = global.customBotConfigs.get(key);
    if (custom && Array.isArray(custom.images) && custom.images.length > 0) {
        return custom.images[Math.floor(Math.random() * custom.images.length)];
    }

    const config = global.botStylesMap.get(key);
    const list = (config && config.images && config.images.length)
        ? config.images
        : (global.botImages || []);

    if (!list.length) return undefined;
    return list[Math.floor(Math.random() * list.length)];
};

global.channelInfo = {
    forwardingScore: 1,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
        get newsletterJid() {
            const key = formatJid(typeof conn !== 'undefined' ? conn : global.conn);
            const custom = global.customBotConfigs.get(key);
            return custom?.channelJid || defaultChannel;
        },
        get newsletterName() {
            return global.name(typeof conn !== 'undefined' ? conn : global.conn);
        }
    }
};

export async function loadBotStyle(botJid) {
    loadAllStyles();
}

export async function setBotStyle(botJid, styleId) {
    const cleanJid = formatJid(botJid);
    let styles = {};

    try {
        const rawData = await fs.readFile(stylesPath, 'utf-8');
        styles = JSON.parse(rawData);
    } catch (e) {
        return { success: false, error: "FILE_READ_ERROR" };
    }

    if (!styles[styleId]) {
        return { success: false, error: "STYLE_NOT_FOUND" };
    }

    for (const key of Object.keys(styles)) {
        if (Array.isArray(styles[key].ids)) {
            styles[key].ids = styles[key].ids.filter(id => formatJid(id) !== cleanJid);
        }
    }

    delete styles[`custom_${cleanJid}`];

    if (!Array.isArray(styles[styleId].ids)) {
        styles[styleId].ids = [];
    }

    styles[styleId].ids.push(cleanJid);

    await fs.writeFile(stylesPath, JSON.stringify(styles, null, 2), 'utf-8');
    loadAllStyles();

    return { success: true, name: styles[styleId].name || `Estilo ${styleId}` };
}

export async function getStylesList(botJid) {
    const cleanJid = formatJid(botJid);
    try {
        const rawData = await fs.readFile(stylesPath, 'utf-8');
        const styles = JSON.parse(rawData);

        return Object.keys(styles)
            .filter(key => !key.startsWith('custom_'))
            .map(key => {
                const style = styles[key];
                const isCurrent = Array.isArray(style.ids) && style.ids.some(id => formatJid(id) === cleanJid);
                const isDefault = Array.isArray(style.ids) && style.ids.includes(DEFAULT_STYLE_MARKER);
                return {
                    id: key,
                    name: style.name || 'Sin Nombre',
                    isCurrent,
                    isDefault,
                    namesCount: style.botNames ? style.botNames.length : 0,
                    imagesCount: style.botImages ? style.botImages.length : 0
                };
            });
    } catch (e) {
        return [];
    }
}

async function uploadToDixCdn(buffer) {
    try {
        const form = new FormData();
        form.append('file', buffer, { filename: 'custom_avatar.jpg' });

        const response = await axios.post('https://cdn.dix.lat/upload/tmp?ttl=2592000', form, {
            headers: {
                ...form.getHeaders()
            }
        });

        if (response.data && response.data.status && response.data.data?.url) {
            return response.data.data.url;
        }
        return null;
    } catch (e) {
        console.error("Error al subir imagen a Dix CDN:", e);
        return null;
    }
}

export async function setCustomBotConfig(botJid, options = {}) {
    const cleanJid = formatJid(botJid);
    let styles = {};

    try {
        const rawData = await fs.readFile(stylesPath, 'utf-8');
        styles = JSON.parse(rawData);
    } catch (e) {
        styles = {};
    }

    for (const key of Object.keys(styles)) {
        if (Array.isArray(styles[key].ids)) {
            styles[key].ids = styles[key].ids.filter(id => formatJid(id) !== cleanJid);
        }
    }

    const customKey = `custom_${cleanJid}`;
    const existingCustom = styles[customKey] || {};

    let finalImageUrl = options.imageUrl || null;
    if (!finalImageUrl && options.imageBuffer) {
        finalImageUrl = await uploadToDixCdn(options.imageBuffer);
    }

    
    const botNames = options.name ? [options.name] : (existingCustom.botNames || global.botNames);
    const botImages = finalImageUrl ? [finalImageUrl] : (existingCustom.botImages || global.botImages || []);
    const channelJid = options.channelJid || existingCustom.channelJid || defaultChannel;
    const url = options.url || existingCustom.url || 'https://dix.lat/s/channel';

    styles[customKey] = {
        name: `Personalizado (${cleanJid})`,
        botNames,
        botImages,
        channelJid,
        url
    };

    await fs.writeFile(stylesPath, JSON.stringify(styles, null, 2), 'utf-8');
    loadAllStyles();

    return {
        success: true,
        data: {
            name: botNames[0],
            channelJid,
            url,
            hasCustomImage: botImages.length > 0
        }
    };
}

global.bufferCache = global.bufferCache || new Map();
global.getBuffer = async (u, o = {}) => {
    try {
        let r = await axios.get(u, { ...o, responseType: 'arraybuffer' });
        return r.status === 200 ? r.data : null;
    } catch { return null; }
};