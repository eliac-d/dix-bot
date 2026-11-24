import './src/config/index.js';
import 'dotenv/config';
import { platform } from 'process';
import { fileURLToPath, pathToFileURL } from 'url';
import path, { join, basename } from 'path';
import { watch, promises as fsP } from 'fs';
import pino from 'pino';
import NodeCache from 'node-cache';
import yargs from 'yargs';
import { Boom } from '@hapi/boom';
import * as baileysNs from '@whiskeysockets/baileys';
import { makeWASocket, makeCacheableSignalKeyStore, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';

import { smsg } from './core/serializer.js';
import { cacheManager } from './core/cache.js';
import { observeEvents } from './core/event/detect.js';
import { initPreview } from './src/utils/preview-link.js';
import { initButtons } from './src/utils/buttons.js';
import { initGlobals } from './src/utils/globals.js';
import { printBanner, log, ask, pairingCard, onlineCard } from './src/utils/dix-ui.js';
import { ensureApiKey } from './src/utils/apikey.js';
import { initSerbotBridge, updateMainConn, loadSubBots } from './core/s/serbot-bridge.js';
import { databaseManager } from './database/db_adapter.js';

const startingLocks = new Set();

if (!global.__process_events_initialized) {
    process.setMaxListeners(30);

    const flushData = async () => {
        if (global._flushing) return;
        global._flushing = true;
        if (global.dirtyUsers && global.dirtyUsers.size > 0) {
            const usersToSave = Array.from(global.dirtyUsers);
            global.dirtyUsers.clear();
            const dataArray = usersToSave.map(jid => global.userCache.get(jid)).filter(Boolean);
            try {
                if (dataArray.length > 0) await databaseManager.saveUsersBulk(dataArray);
            } catch (_) {}
        }
        process.exit(0);
    };

    process.on('SIGINT', flushData);
    process.on('SIGTERM', flushData);

    process.on('uncaughtException', (err) => {
        console.error('[uncaughtException]', err?.stack || err);
    });

    process.on('unhandledRejection', (reason) => {
        const msg = reason instanceof Error ? reason.message : String(reason);
        console.error('[unhandledRejection]', reason instanceof Error ? reason.stack : msg);
    });

    global.__process_events_initialized = true;
}

global.groupCache = cacheManager.cache;
global.conns = global.conns || new Map();

const sId = (jid) => {
    if (!jid) return jid;
    const index = jid.indexOf('@');
    if (index !== -1) {
        const user = jid.slice(0, index);
        const splitCol = user.indexOf(':');
        return (splitCol !== -1 ? user.slice(0, splitCol) : user) + '@s.whatsapp.net';
    }
    const splitCol = jid.indexOf(':');
    return (splitCol !== -1 ? jid.slice(0, splitCol) : jid) + '@s.whatsapp.net';
};

global.userCache = new Map();
global.dirtyUsers = new Set();

global.updateUser = (jid, data) => {
    const currentData = global.userCache.get(jid) || {};
    const updatedData = { ...currentData, ...data, id: jid, lastActive: Date.now() };
    global.userCache.set(jid, updatedData);
    global.dirtyUsers.add(jid);
    return updatedData;
};

console.log = (...args) => log.info(...args);
console.info = (...args) => log.info(...args);
console.warn = (...args) => log.warn(...args);
console.error = (...args) => log.fail(...args);

printBanner();
await ensureApiKey();
log.info('Iniciando bot...');

await fsP.mkdir('./database', { recursive: true }).catch(() => {});
await fsP.mkdir('./tmp', { recursive: true }).catch(() => {});
await fsP.mkdir('./sessions', { recursive: true }).catch(() => {});

await databaseManager.init();

if (global._dbSaveInterval) clearInterval(global._dbSaveInterval);
let _isSavingDB = false;
global._dbSaveInterval = setInterval(async () => {
    const sweepCache = () => {
        if (global.userCache.size > 2000) {
            const now = Date.now();
            for (const [jid, data] of global.userCache.entries()) {
                if (now - (data.lastActive || 0) > 3600000 && !global.dirtyUsers.has(jid)) {
                    global.userCache.delete(jid);
                }
            }
        }
    };
    if (global.dirtyUsers.size === 0) { sweepCache(); return; }
    if (_isSavingDB) return;
    _isSavingDB = true;
    const usersToSave = Array.from(global.dirtyUsers);
    global.dirtyUsers.clear();
    const dataArray = usersToSave.map(jid => global.userCache.get(jid)).filter(Boolean);
    try {
        if (dataArray.length > 0) await databaseManager.saveUsersBulk(dataArray);
        sweepCache();
    } catch (_) {
        usersToSave.forEach(jid => global.dirtyUsers.add(jid));
    } finally {
        _isSavingDB = false;
    }
}, 15000);

const sessionDir = './sessions/main';

const deepCleanSession = async () => {
    try {
        const files = await fsP.readdir(sessionDir).catch(() => []);
        const now = Date.now();
        let deletedCount = 0;

        for (const file of files) {
            const filePath = path.join(sessionDir, file);

            if (file.startsWith('device-list-') || file.startsWith('lid-mapping-')) {
                await fsP.unlink(filePath).catch(() => {});
                deletedCount++;
                continue;
            }

            if (file.startsWith('pre-key-')) {
                const stat = await fsP.stat(filePath).catch(() => null);
                if (stat && (now - stat.mtimeMs > 7 * 24 * 60 * 60 * 1000)) {
                    await fsP.unlink(filePath).catch(() => {});
                    deletedCount++;
                }
            }

            if (file.startsWith('session-') || file.startsWith('sender-key-') || file.startsWith('identity-key-')) {
                const stat = await fsP.stat(filePath).catch(() => null);
                if (stat && (now - stat.mtimeMs > 15 * 24 * 60 * 60 * 1000)) {
                    await fsP.unlink(filePath).catch(() => {});
                    deletedCount++;
                }
            }
        }
        if (deletedCount > 0) log.info(`[LIMPIEZA] Se eliminaron ${deletedCount} archivos basura de la sesión.`);
    } catch (_) {}
};

await deepCleanSession();
if (global._deepCleanInterval) clearInterval(global._deepCleanInterval);
global._deepCleanInterval = setInterval(deepCleanSession, 3 * 60 * 60 * 1000);

global.__filename = (pathURL = import.meta.url, rmPrefix = platform !== 'win32') =>
    rmPrefix ? /file:\/\/\//.test(pathURL) ? fileURLToPath(pathURL) : pathURL : pathURL;
global.__dirname = (pathURL) => path.dirname(global.__filename(pathURL, true));

global.opts = new Object(yargs(process.argv.slice(2)).exitProcess(false).parse());
global.prefix = new RegExp('^[#!./]');

const FALLBACK_VERSION = [2, 3000, 1043716065];

const resolveVersion = async () => {
    if (typeof baileysNs.fetchLatestBaileysVersion !== 'function') return FALLBACK_VERSION;
    try {
        const result = await Promise.race([
            baileysNs.fetchLatestBaileysVersion(),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))
        ]);
        return Array.isArray(result?.version) && result.version.length === 3 ? result.version : FALLBACK_VERSION;
    } catch (_) {
        return FALLBACK_VERSION;
    }
};

const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
const version = await resolveVersion();
log.info(`Versión de WhatsApp: ${version.join('.')}`);
const msgRetryCounterCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

let pairingNumber = '';
if (!state.creds.registered) {
    pairingNumber = String(await ask('Número del bot con código de país (ej: 51999999999)') || '').replace(/\D/g, '');
}

const connectionOptions = {
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['Ubuntu', 'Chrome', '124.0.0.0'],
    auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
    },
    markOnlineOnConnect: false,
    syncFullHistory: false,
    emitOwnEvents: false,
    msgRetryCounterCache,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 30000,
    keepAliveIntervalMs: 30000,
    getMessage: async () => undefined
};

const setupPairing = (sock) => {
    global._requestPairing = null;
    if (!pairingNumber || sock.authState?.creds?.registered) return;
    let requested = false;
    const request = async () => {
        if (requested || sock.authState?.creds?.registered) return;
        requested = true;
        try {
            const codeBot = await sock.requestPairingCode(pairingNumber);
            pairingCard(codeBot?.match(/.{1,4}/g)?.join('-') || codeBot);
        } catch (e) {
            console.error('[pairing]', e?.message || e);
        }
    };
    global._requestPairing = request;
    setTimeout(request, 6000);
};

global.conn = makeWASocket(connectionOptions);
initPreview(global.conn);
initButtons(global.conn);
initGlobals(global.conn);
global.conn.ev.on('creds.update', saveCreds);
global.conn.isMain = true;
global.conns.set('main', global.conn);
setupPairing(global.conn);

global._reconnectAttempts = 0;
let _authFailedAttempts = 0;
let _disableMainBot = false;
const MAX_RECONNECT_DELAY = 60000;
const MAX_RECONNECT_ATTEMPTS = 50;
let _reconnectTimer = null;
let _isReconnecting = false;

function getReconnectDelay() {
    const base = Math.min(10000 * (global._reconnectAttempts + 1), MAX_RECONNECT_DELAY);
    const jitter = base * (0.8 + Math.random() * 0.4);
    global._reconnectAttempts++;
    return Math.round(jitter);
}

let messageHandlerMain;

const loadCoreRouter = async () => {
    try {
        const PathMain = path.join(process.cwd(), 'core/message.js');
        const moduleMain = await import(`file://${PathMain}?update=${Date.now()}`);
        messageHandlerMain = moduleMain.message || moduleMain.default?.message || moduleMain.default;
    } catch (e) { console.error(e?.message || e); }
};

function debounce(fn, ms) {
    let t = null;
    return (...args) => {
        if (t) clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
}

await loadCoreRouter();
watch(path.join(process.cwd(), 'core/message.js'), debounce(loadCoreRouter, 300));

global.reload = async function (restatConn) {
    if (_disableMainBot) return;
    if (startingLocks.has('main')) return;
    if (_isReconnecting && restatConn) return;

    if (restatConn) {
        if (global._reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            log.fail('Máximo de reintentos alcanzado. Deteniendo.');
            _disableMainBot = true;
            return;
        }
        startingLocks.add('main');
        _isReconnecting = true;
        try {
            if (global.conn?.ev) {
                global.conn.ev.removeAllListeners('messages.upsert');
                global.conn.ev.removeAllListeners('connection.update');
                global.conn.ev.removeAllListeners('groups.update');
            }
            if (global.conn?.ws) global.conn.ws.close();
        } catch (_) {}
        try { if (global.conn?.end) global.conn.end(new Error('Reconnection')); } catch (_) {}
        await new Promise(r => setTimeout(r, 1000));
        await deepCleanSession();
        await new Promise(r => setTimeout(r, 500));
        const { state: newState, saveCreds: newSaveCreds } = await useMultiFileAuthState(sessionDir);
        global.conn = makeWASocket({
            ...connectionOptions,
            auth: {
                creds: newState.creds,
                keys: makeCacheableSignalKeyStore(newState.keys, pino({ level: 'silent' })),
            }
        });
        initPreview(global.conn);
        initButtons(global.conn);
        initGlobals(global.conn);
        global.conn.ev.on('creds.update', newSaveCreds);
        global.conn.isMain = true;
        global.conns.set('main', global.conn);
        setupPairing(global.conn);
        _isReconnecting = false;
        startingLocks.delete('main');
    }

    global.conn.ev.removeAllListeners('messages.upsert');
    observeEvents(global.conn);
    global.conn.ev.on('messages.upsert', async (chatUpdate) => {
        if (!chatUpdate?.messages?.length) return;

        for (const msg of chatUpdate.messages) {
            if (!msg) continue;

            Promise.resolve().then(async () => {
                try {
                    const m = await smsg(global.conn, msg);
                    if (!m) return;
                    if (typeof messageHandlerMain === 'function') {
                        await messageHandlerMain.call(global.conn, m, chatUpdate);
                    }
                } catch (e) {
                    console.error('[messages.upsert]', e?.message || '');
                }
            });
        }
    });

    global.conn.ev.removeAllListeners('connection.update');
    global.conn.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (update.qr && typeof global._requestPairing === 'function') {
            global._requestPairing();
        }

        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode || 0;
            log.warn(`Desconectado (${reason}) ${lastDisconnect?.error?.message || ''}`);

            const isRegistered = Boolean(global.conn.authState?.creds?.registered);

            if (isRegistered && (reason === DisconnectReason.loggedOut || reason === 401 || reason === 403)) {
                _authFailedAttempts++;
                log.fail(`Fallo de autenticación (${_authFailedAttempts}/2)`);
                if (_authFailedAttempts >= 2) {
                    _disableMainBot = true;
                    log.fail('Bot deshabilitado permanentemente.');
                    return;
                }
            }

            if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
            const delay = getReconnectDelay();
            log.info(`Reintento #${global._reconnectAttempts} en ${Math.round(delay / 1000)}s`);
            _reconnectTimer = setTimeout(() => { _reconnectTimer = null; global.reload(true); }, delay);
        }
        if (connection === 'open') {
            if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
            _isReconnecting = false;
            global._reconnectAttempts = 0;
            _authFailedAttempts = 0;
            global.botNumber = sId(global.conn.user.id);
            initGlobals(global.conn);
            updateMainConn(global.conn);
            await loadSubBots(global.conn);
            onlineCard(global.botNumber);

            try {
                const groups = await global.conn.groupFetchAllParticipating().catch(() => ({}));
                for (const id in groups) {
                    cacheManager.updateParticipants(id, groups[id].participants);
                    global.groupCache.set(id, groups[id]);
                }
            } catch (_) {}
        }
    });

    global.conn.ev.removeAllListeners('groups.update');
    global.conn.ev.on('groups.update', async (updates) => {
        for (const update of updates) {
            if (!update?.id) continue;
            try {
                const metadata = await global.conn.groupMetadata(update.id).catch(() => null);
                if (metadata) {
                    global.groupCache.set(update.id, metadata);
                    cacheManager.updateParticipants(update.id, metadata.participants);
                }
            } catch (_) {}
        }
    });
};

await global.reload();

global.modules = new Map();
global.commands = new Map();
global.aliases = new Map();

const getFilesRecursive = async (dir) => {
    let results = [];
    try {
        const list = await fsP.readdir(dir).catch(() => []);
        for (const file of list) {
            const filePath = join(dir, file);
            const stat = await fsP.stat(filePath).catch(() => null);
            if (!stat) continue;
            if (stat.isDirectory()) results = results.concat(await getFilesRecursive(filePath));
            else if (file.endsWith('.js')) results.push(filePath);
        }
    } catch (_) {}
    return results;
};

let _reloadingModules = false;
global.reloadModules = async function (check) {
    if (_reloadingModules) return false;
    _reloadingModules = true;
    try {
        global.modules.clear();
        global.commands.clear();
        global.aliases.clear();

        const modulesDir = join(process.cwd(), './modules');
        const files = await getFilesRecursive(modulesDir);
        for (const filePath of files) {
            try {
                const fileUrl = pathToFileURL(filePath).href;
                const imported = await import(`${fileUrl}?update=${Date.now()}`);
                const mod = imported.default || imported;

                for (const key in mod) {
                    const possibleGroup = mod[key];
                    if (possibleGroup && possibleGroup.commands) {
                        const moduleName = basename(filePath, '.js');
                        global.modules.set(moduleName, possibleGroup);
                        for (const cmdKey in possibleGroup.commands) {
                            const cmd = possibleGroup.commands[cmdKey];
                            cmd.category = possibleGroup.category || 'general';
                            if (path.relative(modulesDir, filePath).split(path.sep)[0].toLowerCase() === 'prueba') cmd.experimental = true;
                            global.commands.set(cmd.name, cmd);
                            if (cmd.alias && Array.isArray(cmd.alias)) {
                                cmd.alias.forEach(a => global.aliases.set(a, cmd.name));
                            }
                        }
                    }
                }
            } catch (_) {}
        }
        if (check) return true;
    } finally {
        _reloadingModules = false;
    }
};

await global.reloadModules();
initSerbotBridge(global.conn);
