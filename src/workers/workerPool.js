import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(__dirname, 'workerRouter.js');

const TASK_TIMEOUT = 60000;
const IDLE_TIMEOUT = 30000;
const SHUTDOWN_GRACE_MS = 1500;
const MAX_QUEUE = 20;

let workerEntry = null;
const queue = [];

function createWorker() {
    const entry = {
        worker: new Worker(WORKER_PATH),
        busy: false,
        dead: false,
        lastUsed: Date.now(),
        resolve: null,
        reject: null,
        timer: null
    };

    entry.worker.on('message', (msg) => {
        if (!entry.busy || entry.dead) return;
        if (msg && msg.type === '__shutdown_ack__') return;

        if (msg && msg.success) {
            let result = msg.result;
            if (result && result.isBuffer && result.data) {
                result = { ...result, buffer: Buffer.from(result.data.buffer, result.data.byteOffset, result.data.byteLength) };
                delete result.data;
                delete result.isBuffer;
            }
            finishTask(entry, true, result, null);
        } else {
            finishTask(entry, false, null, new Error((msg && msg.error) || 'Error desconocido en el worker'));
        }
    });

    entry.worker.on('error', (err) => retire(entry, err));

    entry.worker.on('exit', (code) => {
        retire(entry, new Error(`El worker finalizó inesperadamente (código ${code})`));
    });

    return entry;
}

function finishTask(entry, success, result, error) {
    if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
    }
    const resolve = entry.resolve;
    const reject = entry.reject;
    entry.resolve = null;
    entry.reject = null;
    entry.busy = false;
    entry.lastUsed = Date.now();

    if (success) resolve?.(result);
    else reject?.(error);

    processQueue();
}

function retire(entry, error) {
    if (entry.dead) return;
    entry.dead = true;

    if (workerEntry === entry) workerEntry = null;

    if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
    }

    const reject = entry.reject;
    const wasBusy = entry.busy;
    entry.resolve = null;
    entry.reject = null;
    entry.busy = false;

    try { entry.worker.postMessage({ type: '__shutdown__' }); } catch (_) {}

    setTimeout(() => {
        try { entry.worker.terminate().catch(() => {}); } catch (_) {}
    }, SHUTDOWN_GRACE_MS).unref();

    if (wasBusy && reject) reject(error || new Error('Worker reiniciado'));

    processQueue();
}

function runTask(entry, task, resolve, reject) {
    entry.busy = true;
    entry.lastUsed = Date.now();
    entry.resolve = resolve;
    entry.reject = reject;

    entry.timer = setTimeout(() => {
        retire(entry, new Error('La tarea superó el tiempo límite (TASK_TIMEOUT)'));
    }, TASK_TIMEOUT);

    try {
        entry.worker.postMessage(task);
    } catch (e) {
        retire(entry, e);
    }
}

function tryAssign(task, resolve, reject) {
    if (!workerEntry) workerEntry = createWorker();

    if (!workerEntry.busy) {
        runTask(workerEntry, task, resolve, reject);
        return true;
    }
    return false;
}

function processQueue() {
    while (queue.length) {
        const item = queue[0];
        if (tryAssign(item.task, item.resolve, item.reject)) queue.shift();
        else break;
    }
}

setInterval(() => {
    if (workerEntry && !workerEntry.busy && Date.now() - workerEntry.lastUsed > IDLE_TIMEOUT) {
        retire(workerEntry, null);
    }
}, 10000).unref();

export function dispatchMediaTask(task) {
    return new Promise((resolve, reject) => {
        if (!tryAssign(task, resolve, reject)) {
            if (queue.length >= MAX_QUEUE) {
                reject(new Error('Servidor ocupado, intenta de nuevo en unos segundos'));
                return;
            }
            queue.push({ task, resolve, reject });
        }
    });
}

export function getWorkerStats() {
    return {
        active: workerEntry && workerEntry.busy ? 1 : 0,
        idle: workerEntry && !workerEntry.busy ? 1 : 0,
        queued: queue.length,
        total: workerEntry ? 1 : 0,
        maxWorkers: 1
    };
}
