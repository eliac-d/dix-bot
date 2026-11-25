import { parentPort } from 'worker_threads';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { readFile, writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : d;
};

const MAX_BYTES = 15 * 1048576;
const FETCH_TIMEOUT = 30000;
const FFMPEG_TIMEOUT = 40000;
const TOTAL_TIMEOUT = 15000;
const TMP_MAX_AGE = 60000;
const STICKER_FPS = num(process.env.STICKER_FPS, 10);
const STICKER_SIZE = num(process.env.STICKER_SIZE, 512);
const STICKER_SECONDS = num(process.env.STICKER_SECONDS, 8);
const STICKER_QUALITY = num(process.env.STICKER_QUALITY, 40);
const IMAGE_QUALITY = num(process.env.STICKER_IMAGE_QUALITY, 70);
const COMPRESSION = Math.min(6, Math.round(num(process.env.STICKER_COMPRESSION, 3)));
const THREADS = Math.round(num(process.env.STICKER_THREADS, 2));
const ANIM_MAX = num(process.env.STICKER_ANIM_MAX_KB, 800) * 1024;
const IMAGE_MAX = num(process.env.STICKER_IMAGE_MAX_KB, 300) * 1024;

const TMP_DIR = (() => {
    const wanted = process.env.TMPDIR || '/home/container/tmp';
    try {
        if (!existsSync(wanted)) mkdirSync(wanted, { recursive: true });
        return wanted;
    } catch (_) {
        return tmpdir();
    }
})();

let activeProc = null;
let premulOk = true;
let closing = false;

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
    if (buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength) {
        return new Uint8Array(buf.buffer, 0, buf.byteLength);
    }
    const out = new Uint8Array(buf.byteLength);
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

function detect(buf) {
    if (buf.length < 16) return { anim: true, alpha: false };
    const head = buf.toString('latin1', 0, 12);
    if (buf[0] === 0x89 && head.slice(1, 4) === 'PNG') {
        return { anim: buf.subarray(0, 4096).includes('acTL'), alpha: true };
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) return { anim: false, alpha: false };
    if (head.startsWith('BM')) return { anim: false, alpha: false };
    if (head.startsWith('GIF')) return { anim: true, alpha: true };
    if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') {
        const anim = buf.toString('latin1', 12, 16) === 'VP8X' && (buf[20] & 0x02) !== 0;
        return { anim, alpha: true };
    }
    return { anim: true, alpha: false };
}

function ladder(anim) {
    const base = anim ? STICKER_QUALITY : IMAGE_QUALITY;
    const steps = anim ? [1, 0.6, 0.35] : [1, 0.6];
    const even = (n) => Math.max(128, Math.round(n / 2) * 2);
    return steps.map((k, i) => ({
        q: Math.max(10, Math.round(base * k)),
        fps: Math.max(6, STICKER_FPS - i * 2),
        size: even(STICKER_SIZE * (i < 2 ? 1 : 0.75))
    }));
}

function parseKey(task) {
    const raw = String(task.transparentColor || '').replace(/^#|^0x/i, '');
    if (!/^[0-9a-f]{6}$/i.test(raw)) return null;
    const sim = Math.min(0.6, Math.max(0.01, Number(task.similarity) || 0.15));
    return { color: raw, sim };
}

function ffArgs(src, out, p, kind, key, premul) {
    const { anim, alpha } = kind;
    const scale = `scale=${p.size}:${p.size}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=bicubic`;
    const f = [];
    if (anim) f.push(`fps=${p.fps}`);
    if (alpha || key) {
        f.push('format=rgba');
        if (premul && alpha) f.push('premultiply=inplace=1');
        f.push(scale);
        if (premul && alpha) f.push('unpremultiply=inplace=1', 'format=rgba');
        if (key) f.push(`colorkey=0x${key.color}:${key.sim}:0.1`);
    } else {
        f.push(scale, 'format=yuva420p');
    }
    f.push(`pad=${p.size}:${p.size}:(ow-iw)/2:(oh-ih)/2:color=black@0`);
    f.push('format=yuva420p');

    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-threads', String(THREADS)];
    if (anim) args.push('-t', String(STICKER_SECONDS));
    args.push('-i', src, '-map', '0:v:0', '-an', '-sn', '-dn');
    if (!anim) args.push('-frames:v', '1');
    args.push(
        '-vf', f.join(','),
        '-c:v', 'libwebp',
        '-q:v', String(p.q),
        '-compression_level', String(COMPRESSION),
        '-lossless', '0',
        '-pix_fmt', 'yuva420p'
    );
    if (anim) args.push('-loop', '0');
    args.push('-f', 'webp', out);
    return args;
}

function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
        activeProc = proc;
        let errText = '';
        let timedOut = false;
        let finished = false;

        const timer = setTimeout(() => {
            timedOut = true;
            try { proc.kill('SIGKILL'); } catch (_) {}
        }, FFMPEG_TIMEOUT);

        const done = (err) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (activeProc === proc) activeProc = null;
            if (err) reject(err);
            else resolve();
        };

        proc.stderr.on('data', (d) => { errText = (errText + d.toString()).slice(-600); });
        proc.on('error', (e) => {
            done(e.code === 'ENOENT' ? new Error('ffmpeg no está instalado') : e);
        });
        proc.on('close', (code) => {
            if (code === 0) return done();
            const err = new Error(timedOut
                ? 'ffmpeg excedió el tiempo límite'
                : `ffmpeg falló (código ${code}): ${errText.trim() || 'sin salida'}`);
            err.timedOut = timedOut;
            done(err);
        });
    });
}

async function attempt(src, out, p, kind, key) {
    if (premulOk) {
        try {
            await runFfmpeg(ffArgs(src, out, p, kind, key, true));
            return;
        } catch (e) {
            const filterIssue = /premultiply|Impossible to convert|reinitializing filters|initializing filter/i.test(e.message);
            if (e.timedOut || !filterIssue) throw e;
            premulOk = false;
        }
    }
    await runFfmpeg(ffArgs(src, out, p, kind, key, false));
}

async function encode(src, out, kind, key) {
    const anim = kind.anim;
    const max = anim ? ANIM_MAX : IMAGE_MAX;
    const started = Date.now();
    let best = null;
    for (const p of ladder(anim)) {
        await attempt(src, out, p, kind, key);
        const buf = await readFile(out);
        if (!best || buf.length < best.length) best = buf;
        if (buf.length <= max) break;
        if (Date.now() - started > TOTAL_TIMEOUT) break;
    }
    return best;
}

function buildExif(packname, author, categories) {
    const json = Buffer.from(JSON.stringify({
        'sticker-pack-id': randomBytes(16).toString('hex'),
        'sticker-pack-name': String(packname || ''),
        'sticker-pack-publisher': String(author || ''),
        emojis: Array.isArray(categories) && categories.length ? categories : ['🤩']
    }), 'utf8');
    const head = Buffer.from([
        0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57,
        0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00
    ]);
    const exif = Buffer.concat([head, json]);
    exif.writeUInt32LE(json.length, 14);
    return exif;
}

function simpleDims(body, fourcc) {
    if (fourcc === 'VP8 ') {
        if (body[11] !== 0x9d || body[12] !== 0x01 || body[13] !== 0x2a) throw new Error('WebP inválido');
        return { w: body.readUInt16LE(14) & 0x3fff, h: body.readUInt16LE(16) & 0x3fff, alpha: false };
    }
    if (fourcc === 'VP8L') {
        if (body[8] !== 0x2f) throw new Error('WebP inválido');
        const b = body.subarray(9, 13);
        return {
            w: 1 + (b[0] | ((b[1] & 0x3f) << 8)),
            h: 1 + ((b[1] >> 6) | (b[2] << 2) | ((b[3] & 0x0f) << 10)),
            alpha: ((b[3] >> 4) & 1) === 1
        };
    }
    throw new Error('WebP inválido');
}

function injectExif(webp, exif) {
    if (webp.length < 20 || webp.toString('latin1', 0, 4) !== 'RIFF' || webp.toString('latin1', 8, 12) !== 'WEBP') {
        throw new Error('El motor no generó un WebP válido');
    }
    let body = webp.subarray(12);
    const fourcc = body.toString('latin1', 0, 4);

    if (fourcc === 'VP8X') {
        body = Buffer.from(body);
        body[8] |= 0x08;
    } else {
        const { w, h, alpha } = simpleDims(body, fourcc);
        const vp8x = Buffer.alloc(18);
        vp8x.write('VP8X', 0, 'latin1');
        vp8x.writeUInt32LE(10, 4);
        vp8x[8] = 0x08 | (alpha ? 0x10 : 0);
        vp8x.writeUIntLE(w - 1, 12, 3);
        vp8x.writeUIntLE(h - 1, 15, 3);
        body = Buffer.concat([vp8x, body]);
    }

    const chunkHead = Buffer.alloc(8);
    chunkHead.write('EXIF', 0, 'latin1');
    chunkHead.writeUInt32LE(exif.length, 4);
    const pad = exif.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0);

    const riff = Buffer.alloc(12);
    riff.write('RIFF', 0, 'latin1');
    riff.write('WEBP', 8, 'latin1');

    const out = Buffer.concat([riff, body, chunkHead, exif, pad]);
    out.writeUInt32LE(out.length - 8, 4);
    return out;
}

function asBuffer(raw) {
    return ArrayBuffer.isView(raw)
        ? Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength)
        : Buffer.from(raw);
}

async function trayTask(task) {
    const input = asBuffer(task.data);
    if (input.length > MAX_BYTES) throw new Error('Archivo demasiado grande (máx 15MB)');
    if (!input.length) throw new Error('Archivo vacío');

    const size = Math.round(num(task.size, 96));
    const id = randomBytes(6).toString('hex');
    const src = join(TMP_DIR, `stk_${id}.in`);
    const out = join(TMP_DIR, `stk_${id}.png`);

    try {
        await writeFile(src, input);
        const vf = [
            'format=rgba',
            `scale=${size}:${size}:force_original_aspect_ratio=decrease:flags=bicubic`,
            `pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=black@0`,
            'format=rgba'
        ].join(',');
        await runFfmpeg([
            '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
            '-i', src, '-map', '0:v:0', '-an', '-sn', '-dn',
            '-frames:v', '1', '-vf', vf, '-c:v', 'png', '-f', 'image2', out
        ]);
        const png = await readFile(out);
        return { isBuffer: true, data: toTransferable(png) };
    } finally {
        await unlink(src).catch(() => {});
        await unlink(out).catch(() => {});
    }
}

async function convertTask(task) {
    let input = asBuffer(task.data);

    if (input.length > MAX_BYTES) throw new Error('Archivo demasiado grande (máx 15MB)');
    if (!input.length) throw new Error('Archivo vacío');

    const kind = detect(input);
    const key = parseKey(task);
    const id = randomBytes(6).toString('hex');
    const src = join(TMP_DIR, `stk_${id}.in`);
    const out = join(TMP_DIR, `stk_${id}.webp`);

    try {
        await writeFile(src, input);
        input = null;
        const webp = await encode(src, out, kind, key);
        const sticker = injectExif(webp, buildExif(task.packname, task.author, task.emojis));
        return { isBuffer: true, data: toTransferable(sticker) };
    } finally {
        await unlink(src).catch(() => {});
        await unlink(out).catch(() => {});
    }
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
    convert_sticker: (task) => convertTask(task),
    convert_tray: (task) => trayTask(task),
    convert_emoji_gif: (task) => convertTask(task),
    convert_brat_or_mix: (task) => convertTask({ ...task, emojis: undefined })
};

async function run(task) {
    if (closing) return;
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
}

let chain = Promise.resolve();

parentPort.on('message', (task) => {
    if (task && task.type === '__shutdown__') {
        closing = true;
        killActiveProc();
        try { parentPort.postMessage({ type: '__shutdown_ack__' }); } catch (_) {}
        return;
    }
    chain = chain.then(() => run(task));
});
