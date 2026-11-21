import { parentPort } from 'worker_threads';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { fileTypeFromBuffer } from 'file-type';
import * as pix from 'pixcore';

const TMP_DIR = process.env.TMPDIR || '/home/container/tmp';
const MAX_BYTES = 15 * 1024 * 1024;
const FETCH_TIMEOUT = 30000;
const FFMPEG_TIMEOUT = 45000;
const TMP_MAX_AGE = 60000;
const STICKER_FPS = Number(process.env.STICKER_FPS) || 12;
const STICKER_SIZE = Number(process.env.STICKER_SIZE) || 320;
const STICKER_SECONDS = Number(process.env.STICKER_SECONDS) || 8;
const STICKER_QUALITY = Number(process.env.STICKER_QUALITY) || 50;
const TRANSPARENT_BG = { r: 0, g: 0, b: 0, alpha: 0 };

try {
    if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
} catch (_) {}

let activeProc = null;

function killActiveProc() {
    if (activeProc) {
        try { activeProc.kill('SIGKILL'); } catch (_) {}
        activeProc = null;
    }
}

function cleanTmp(maxAge = TMP_MAX_AGE) {
    try {
        const now = Date.now();
        for (const file of readdirSync(TMP_DIR)) {
            if (!file.startsWith('mw_') && !file.startsWith('stk_')) continue;
            const filePath = join(TMP_DIR, file);
            try {
                if (now - statSync(filePath).mtimeMs >= maxAge) unlinkSync(filePath);
            } catch (_) {}
        }
    } catch (_) {}
}

cleanTmp(0);
setInterval(() => cleanTmp(TMP_MAX_AGE), 60000).unref();

function toTransferable(buf) {
    const out = new Uint8Array(buf.length);
    out.set(buf);
    return out;
}

async function fetchBuffer(url, headers = {}, maxBytes = MAX_BYTES) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > maxBytes) throw new Error(`Archivo demasiado grande (máx ${Math.floor(maxBytes / 1048576)}MB)`);
    const chunks = [];
    let total = 0;
    for await (const chunk of res.body) {
        total += chunk.length;
        if (total > maxBytes) throw new Error(`Archivo demasiado grande (máx ${Math.floor(maxBytes / 1048576)}MB)`);
        chunks.push(chunk);
    }
    return Buffer.concat(chunks, total);
}

function encodeWebp(source) {
    return new Promise((resolve, reject) => {
        const vf = [
            `fps=${STICKER_FPS}`,
            `scale=${STICKER_SIZE}:${STICKER_SIZE}:force_original_aspect_ratio=decrease:flags=lanczos`,
            `pad=${STICKER_SIZE}:${STICKER_SIZE}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
            'format=yuva420p'
        ].join(',');

        const args = [
            '-hide_banner', '-loglevel', 'error', '-threads', '1',
            '-i', source.file || 'pipe:0',
            '-t', String(STICKER_SECONDS),
            '-an', '-vf', vf,
            '-c:v', 'libwebp', '-q:v', String(STICKER_QUALITY),
            '-compression_level', '3', '-preset', 'default',
            '-loop', '0', '-vsync', '0',
            '-f', 'webp', 'pipe:1'
        ];

        const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
        activeProc = proc;

        const out = [];
        let errText = '';
        let finished = false;

        const timer = setTimeout(() => {
            try { proc.kill('SIGKILL'); } catch (_) {}
        }, FFMPEG_TIMEOUT);

        const done = (err, data) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (activeProc === proc) activeProc = null;
            if (err) reject(err);
            else resolve(data);
        };

        proc.stdout.on('data', (d) => out.push(d));
        proc.stderr.on('data', (d) => { errText = (errText + d.toString()).slice(-600); });
        proc.on('error', (e) => done(e));
        proc.on('close', (code) => {
            const result = Buffer.concat(out);
            if (code === 0 && result.length > 0) done(null, result);
            else done(new Error(`ffmpeg falló (código ${code}): ${errText.trim() || 'sin salida'}`));
        });

        proc.stdin.on('error', () => {});
        if (source.file) proc.stdin.end();
        else proc.stdin.end(source.buffer);
    });
}

async function processVideoSticker(buffer, ext) {
    try {
        return await encodeWebp({ buffer });
    } catch (_) {
        const tmp = join(TMP_DIR, `stk_${randomBytes(6).toString('hex')}.${ext || 'bin'}`);
        try {
            writeFileSync(tmp, buffer);
            return await encodeWebp({ file: tmp });
        } finally {
            try { unlinkSync(tmp); } catch (_) {}
        }
    }
}

async function processStickerBuffer(buffer, packname, author, categories = ['🤩']) {
    if (buffer.length > MAX_BYTES) throw new Error('Archivo demasiado grande (máx 15MB)');

    const type = (await fileTypeFromBuffer(buffer)) || { mime: 'image/jpeg', ext: 'jpg' };

    if (/video|gif/i.test(type.mime)) {
        const webpBuffer = await processVideoSticker(buffer, type.ext);
        return await (await pix.read(webpBuffer))
            .webp({ quality: 65, alphaQuality: 100, lossless: false })
            .toBuffer({ exif: { packname, author, categories } });
    }

    return await (await pix.read(buffer))
        .resize(512, 512, { fit: 'contain', background: TRANSPARENT_BG, kernel: 'lanczos3' })
        .webp({ quality: 65, alphaQuality: 100, lossless: false })
        .toBuffer({ exif: { packname, author, categories } });
}

async function convertTask(task, defaultEmojis) {
    const input = Buffer.from(task.data);
    const sticker = await processStickerBuffer(input, task.packname, task.author, task.emojis || defaultEmojis);
    return { isBuffer: true, data: toTransferable(sticker) };
}

const handlers = {
    fetch_json: async (task) => {
        const opts = {
            method: task.method || 'GET',
            headers: { Accept: 'application/json', ...(task.headers || {}) },
            signal: AbortSignal.timeout(FETCH_TIMEOUT)
        };
        if (task.body) opts.body = task.body;
        const res = await fetch(task.url, opts);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return { json: await res.json() };
    },
    fetch_text: async (task) => {
        const opts = {
            method: task.method || 'GET',
            headers: task.headers || {},
            signal: AbortSignal.timeout(FETCH_TIMEOUT)
        };
        if (task.body) opts.body = task.body;
        const res = await fetch(task.url, opts);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return { text: await res.text() };
    },
    fetch_head: async (task) => {
        const res = await fetch(task.url, {
            method: 'HEAD',
            headers: task.headers || {},
            signal: AbortSignal.timeout(FETCH_TIMEOUT)
        });
        return {
            contentLength: res.headers.get('content-length') || '0',
            contentType: res.headers.get('content-type') || ''
        };
    },
    download_buffer: async (task) => {
        const buf = await fetchBuffer(task.url, task.headers || {}, task.maxBytes || MAX_BYTES);
        return {
            isBuffer: true,
            data: toTransferable(buf),
            mimeType: task.mimeType || 'application/octet-stream'
        };
    },
    download_file: async (task) => handlers.download_buffer(task),
    convert_sticker: (task) => convertTask(task, undefined),
    convert_emoji_gif: (task) => convertTask(task, ['🤩']),
    convert_brat_or_mix: (task) => convertTask({ ...task, emojis: undefined }, undefined)
};

parentPort.on('message', async (task) => {
    if (task && task.type === '__shutdown__') {
        killActiveProc();
        try { parentPort.postMessage({ type: '__shutdown_ack__' }); } catch (_) {}
        return;
    }

    try {
        const handler = handlers[task && task.type];
        if (!handler) throw new Error(`Tipo desconocido: ${task && task.type}`);

        const result = await handler(task);

        if (result && result.isBuffer && result.data) {
            parentPort.postMessage({ success: true, result }, [result.data.buffer]);
        } else {
            parentPort.postMessage({ success: true, result });
        }
    } catch (e) {
        killActiveProc();
        parentPort.postMessage({ success: false, error: e.message });
    } finally {
        cleanTmp(TMP_MAX_AGE);
    }
});
