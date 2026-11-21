import fs, { readFileSync } from 'fs';
import { join } from 'path';
import { jidNormalizedUser } from '@whiskeysockets/baileys';
import { read } from 'pixcore';
import fetch from 'node-fetch';

const dbPath = join(process.cwd(), 'database', 'local_db.json');

const readDb = () => {
    try {
        if (!fs.existsSync(dbPath)) return {};
        return JSON.parse(readFileSync(dbPath, 'utf-8'));
    } catch {
        return {};
    }
};

const getTotalCommands = () => (global.commands ? global.commands.size : 0);

const getBotName = (conn) => (typeof name === 'function' ? name(conn) : (conn?.user?.name || 'Bot'));
const getDeveloperName = () => (typeof developer !== 'undefined' ? developer : 'Developer');

const categorySymbols = {
    'INTERACCIONES': '◈',
    'FUN': '✦',
    'DESCARGAS': '⇩',
    'GENERAL': '⌘',
    'DIVERSIÓN': '✧',
    'TOOLS': '⚒',
    'MAIN': '⌂',
    'SEARCH': '⌕',
    'GAME': '♟',
    'GROUP': '⛨',
    'AI': '✵',
    'NSFW': '⊘',
    'SOCIAL': '♡',
    'STICKER': '▣',
    'SUBBOTS': '↯',
    'PRIVADO': '▪',
    'ADMIN': '♛'
};

async function getOptimizedThumbnail(source) {
    if (!source) return Buffer.alloc(0);
    try {
        let inputBuffer;
        if (Buffer.isBuffer(source)) {
            inputBuffer = source;
        } else if (typeof source === 'string' && source.startsWith('http')) {
            const res = await fetch(source);
            if (!res.ok) return Buffer.alloc(0);
            const arrayBuffer = await res.arrayBuffer();
            inputBuffer = Buffer.from(arrayBuffer);
        } else {
            return Buffer.alloc(0);
        }

        const image = await read(inputBuffer);
        const targetW = 300;
        const targetH = 220;
        const srcW = image.width || image.bitmap?.width || 0;
        const srcH = image.height || image.bitmap?.height || 0;

        let processed = image;

        if (srcW > 0 && srcH > 0) {
            const targetRatio = targetW / targetH;
            const srcRatio = srcW / srcH;
            let cropW, cropH, cropX, cropY;

            if (srcRatio > targetRatio) {
                cropH = srcH;
                cropW = Math.round(srcH * targetRatio);
                cropX = Math.round((srcW - cropW) / 2);
                cropY = 0;
            } else {
                cropW = srcW;
                cropH = Math.round(srcW / targetRatio);
                cropX = 0;
                cropY = Math.round((srcH - cropH) / 2);
            }

            if (cropW > 0 && cropH > 0 && (cropW !== srcW || cropH !== srcH)) {
                try {
                    processed = await image.crop(cropX, cropY, cropW, cropH);
                } catch {
                    try {
                        processed = await image.crop(cropW, cropH, cropX, cropY);
                    } catch {
                        processed = image;
                    }
                }
            }
        }

        const resizedBuffer = await processed.resize(targetW, targetH).jpeg({ quality: 92 }).toBuffer();
        return resizedBuffer;
    } catch (e) {
        return Buffer.alloc(0);
    }
}

export const menuCommand = {
    category: 'main',
    commands: {
        help: {
            name: 'menu',
            alias: ['help', 'comandos'],
            run: async (m, { conn, text }) => {
                try {
                    let uptime = clockString(process.uptime() * 1000);
                    const rmrText = typeof global.rmr === 'string' ? global.rmr : 'Sʏsᴛᴇᴍ V5.8.0';

                    const senderJid = m.sender || '';
                    const db = readDb();
                    const isVipTrue = db.vip === true;

                    const categories = {};
                    if (global.commands) {
                        for (const [_, cmd] of global.commands.entries()) {
                            const cat = (cmd.category || 'general').toUpperCase();
                            const folder = cmd.folder ? cmd.folder.toUpperCase() : '';

                            const isPrueba = cat.includes('PRUEBA') || folder.includes('PRUEBA') || folder.includes('MODULES%2FPRUEBA') || folder.includes('MODULES/PRUEBA');

                            if (cat === 'OWNER' || isPrueba) continue;

                            if (isVipTrue && (cat === 'SUBBOTS' || folder === 'SUBBOTS')) continue;

                            if (!categories[cat]) categories[cat] = new Set();

                            let cmdDisplay = cmd.name;
                            if (cmd.alias && Array.isArray(cmd.alias) && cmd.alias.length > 0) {
                                cmdDisplay += ` (${cmd.alias.join(', ')})`;
                            }
                            categories[cat].add(cmdDisplay);
                        }
                    }

                    let menuText1 = `\n〔 Hello, my name is ${getBotName(conn)} 〕\n`;
                    menuText1 += `➥ ⋄ 𝚄𝚜𝚞𝚊𝚛𝚒𝚘 : @${senderJid.split('@')[0]}\n`;
                    menuText1 += `➥ ⋄ 𝙲𝚘𝚖𝚊𝚗𝚍𝚘𝚜: ${getTotalCommands()}\n`;
                    menuText1 += `➥ ⋄ 𝚄𝚙𝚝𝚒𝚖𝚎  : ${uptime}\n`;
                    menuText1 += `➥ ⋄ 𝙰𝚙𝚒  : https://dix.lat\n`;
                    menuText1 += `> www.dynlayer.xyz\n`;

                    let menuText = `${rmrText}\n\n`;

                    const query = (text || '').trim().toUpperCase();

                    if (query === 'ALL' || query === 'TODO') {
                        const keys = Object.keys(categories).sort();
                        for (const title of keys) {
                            const symbol = categorySymbols[title] || '▪';
                            menuText += `┌──「 *${symbol} ${title}* 」──\n`;
                            categories[title].forEach(cmdStr => { menuText += `┃ ♛ *${cmdStr}*\n`; });
                            menuText += `└───────────────\n\n`;
                        }
                        menuText += `» _Escribe *menu* para volver al inicio._\n`;
                    } else if (query && categories[query]) {
                        const symbol = categorySymbols[query] || '▪';
                        menuText += `┌──「 *${symbol} ${query}* 」──\n`;
                        categories[query].forEach(cmdStr => { menuText += `┃ ♛ *${cmdStr}*\n`; });
                        menuText += `└───────────────\n\n`;

                        menuText += `» _Escribe *menu* para volver al inicio._\n`;
                    } else {
                        menuText += `» ¡Hola! Para no llenar tu chat de texto, he dividido mis comandos por categorías.\n\n`;
                        menuText += `» *Escribe el comando con la categoría que quieras ver:*\n\n`;

                        const keys = Object.keys(categories).sort();
                        for (const title of keys) {
                            const symbol = categorySymbols[title] || '▪';
                            const cmdCount = categories[title].size;
                            menuText += `➥ ${symbol} *${title}* (${cmdCount} cmds)\n`;
                        }

                        menuText += `\n» *Ejemplo:* Escribe *menu game* para ver los juegos.\n`;
                        menuText += `» *O escribe *menu all* para ver todos los comandos.*\n`;
                    }

                    menuText += `\n> © Powered by ${getDeveloperName()}.`;

                    const rawBotImg = typeof global.img === 'function' ? global.img(conn) : null;
                    const thumbnailBuffer = await getOptimizedThumbnail(rawBotImg);

                    const rawPayload = {
                        buttonsMessage: {
                            contentText: menuText1,
                            footerText: menuText,
                            headerType: 6,
                            locationMessage: {
                                degreesLatitude: 0,
                                degreesLongitude: 0,
                                url: 'https://dix.lat',
                                name: getBotName(conn),
                                address: getDeveloperName(),
                                jpegThumbnail: thumbnailBuffer
                            },
                            contextInfo: {
                                ...(typeof global.channelInfo === 'object' ? global.channelInfo : {}),
                                forwardingScore: 1,
                                isForwarded: true,
                                forwardOrigin: "UNKNOWN",
                                mentionedJid: [m.sender]
                            }
                        }
                    };

                    await conn.relayMessage(m.chat, rawPayload, { quoted: m });

                } catch (error) {
                    const errorReport = `» *REPORT DE ERROR INTERNO*\n\n` +
                                        `• *Módulo:* help.js\n` +
                                        `• *Comando:* menu\n` +
                                        `• *Error:* ${error.message}`;

                    try {
                        await conn.sendMessage(m.chat, { text: errorReport }, { quoted: m });
                    } catch (sendError) {
                        console.error('Incapaz de transmitir el reporte de error al chat de origen:', sendError);
                    }
                }
            }
        }
    }
};

function clockString(ms) {
    let h = Math.floor(ms / 3600000);
    let m = Math.floor(ms / 60000) % 60;
    let s = Math.floor(ms / 1000) % 60;
    return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
}