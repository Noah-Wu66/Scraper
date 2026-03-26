// ==UserScript==
// @name         数据采集器
// @namespace    http://tampermonkey.net/
// @version      1.2.32
// @description  话题30天数据 + 用户微博数据，统一面板导出表格（多Sheet）
// @author       Your Name
// @match        https://m.weibo.cn/*
// @match        https://m.s.weibo.com/*
// @match        https://w.yangshipin.cn/*
// @match        https://yangshipin.cn/*
// @updateURL    https://raw.githubusercontent.com/Noah-Wu66/Scraper/main/ysjs.js
// @downloadURL  https://raw.githubusercontent.com/Noah-Wu66/Scraper/main/ysjs.js
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = '__weibo_scraper_hub_v1';
    const SCROLL_WAIT_MS = 1800;
    const TOPIC_SCROLL_WAIT_MS = 900;
    const TOPIC_JUMP_DELAY_MIN = 650;
    const TOPIC_JUMP_DELAY_MAX = 1450;
    const TOPIC_BATCH_SIZE = 8;
    const TOPIC_BATCH_REST_MIN = 4000;
    const TOPIC_BATCH_REST_MAX = 8000;
    const TOPIC_SCROLL_BREAK_REST_MIN = 3000;
    const TOPIC_SCROLL_BREAK_REST_MAX = 5500;
    const NO_NEW_RETRY_LIMIT = 6;
    const DEFAULT_COLLECT_RANGE_DAYS = 7;
    const DEFAULT_OVERVIEW_RANGE = '30d';
    const TARGET_UID = '6189120710';
    const TARGET_USER_URL = `https://m.weibo.cn/u/${TARGET_UID}`;
    const CCTV_CPID = '18141106690386005';
    const CCTV_LIST_URL = `https://w.yangshipin.cn/user?cpid=${CCTV_CPID}`;
    const CCTV_DETAIL_BASE = 'https://yangshipin.cn/video/home?vid=';
    const WEIBO_TEXT_CACHE = new Map();
    const PANEL_Z_INDEX = 2147483647;
    const OVERLAY_Z_INDEX = 2147483646;

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    function randInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }
    async function humanScrollToBottom() {
        const maxSteps = randInt(10, 18);
        for (let i = 0; i < maxSteps; i++) {
            const current = window.scrollY || window.pageYOffset || 0;
            const bottom = document.body.scrollHeight - window.innerHeight;
            if (current >= bottom - 5) break;
            const step = randInt(180, 520);
            window.scrollBy(0, step);
            await sleepRange(30, 90);
            if (Math.random() < 0.12) await sleepRange(120, 280);
        }
    }

    async function topicScrollToBottom() {
        const maxSteps = randInt(5, 9);
        for (let i = 0; i < maxSteps; i++) {
            const current = window.scrollY || window.pageYOffset || 0;
            const bottom = document.body.scrollHeight - window.innerHeight;
            if (current >= bottom - 8) break;
            const step = randInt(320, 760);
            window.scrollBy(0, step);
            await sleepRange(18, 45);
            if (Math.random() < 0.08) await sleepRange(80, 180);
        }
    }

    async function scrollToLoadMore(maxRounds) {
        const max = typeof maxRounds === 'number' ? maxRounds : 10;
        for (let i = 0; i < max; i++) {
            await humanScrollToBottom();
            await sleepHumanLike(1200, 600);
        }
    }
    function nowStr() { return new Date().toLocaleString('zh-CN'); }

    function safeJsonParse(str, fallback) {
        try { return JSON.parse(str); } catch { return fallback; }
    }

    function pad(n) { return n < 10 ? '0' + n : n; }

    function toDateTimeLocalValue(date) {
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function buildDefaultCollectRange() {
        const end = new Date();
        const start = new Date(end.getTime() - DEFAULT_COLLECT_RANGE_DAYS * 24 * 60 * 60 * 1000);
        return {
            start,
            end,
            startValue: toDateTimeLocalValue(start),
            endValue: toDateTimeLocalValue(end)
        };
    }

    function defaultState() {
        const range = buildDefaultCollectRange();
        return {
            topic: {
                running: false,
                step: 'idle',
                idx: 0,
                topics: [],
                results: []
            },
            video: {
                running: false,
                results: []
            },
            wechat: {
                results: []
            },
            cctv: {
                running: false,
                step: 'idle',
                idx: 0,
                vids: [],
                results: []
            },
            _pendingStart: null,
            _pendingStartToken: 0,
            overviewRange: DEFAULT_OVERVIEW_RANGE,
            collectRangeStart: range.startValue,
            collectRangeEnd: range.endValue
        };
    }

    function isValidTopicQueueItem(item) {
        return !!(
            item
            && typeof item === 'object'
            && !Array.isArray(item)
            && typeof item.name === 'string'
            && item.name.trim()
            && typeof item.sourcePublishTime === 'string'
            && item.sourcePublishTime.trim()
        );
    }

    function isValidTopicResultItem(item) {
        return !!(
            item
            && typeof item === 'object'
            && !Array.isArray(item)
            && typeof item['来源发布时间'] === 'string'
            && item['来源发布时间'].trim()
        );
    }

    function getTopicQueueItemName(item) {
        return normalizeTopicName(item && typeof item === 'object' ? item.name : '');
    }

    function getTopicQueueItemSourceTime(item) {
        return item && typeof item === 'object' ? String(item.sourcePublishTime || '').trim() : '';
    }

    function loadState() {
        const raw = typeof GM_getValue === 'function'
            ? GM_getValue(STORAGE_KEY, null)
            : localStorage.getItem(STORAGE_KEY);
        const data = safeJsonParse(raw, null);
        return normalizeState(data);
    }

    function parseDateTimeLocalValue(value) {
        if (!value) return null;
        const m = String(value).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{2})$/);
        if (!m) return null;
        return new Date(
            parseInt(m[1], 10),
            parseInt(m[2], 10) - 1,
            parseInt(m[3], 10),
            parseInt(m[4], 10),
            parseInt(m[5], 10),
            0
        );
    }

    function normalizeCollectRange(startValue, endValue) {
        const start = parseDateTimeLocalValue(startValue);
        const end = parseDateTimeLocalValue(endValue);
        if (!start || !end || start > end) return buildDefaultCollectRange();
        return {
            start,
            end,
            startValue: toDateTimeLocalValue(start),
            endValue: toDateTimeLocalValue(end)
        };
    }

    function normalizeState(data) {
        const base = defaultState();
        if (!data || typeof data !== 'object') return base;
        const state = {
            ...base,
            ...data,
            topic: { ...base.topic, ...(data.topic || {}) },
            video: { ...base.video, ...(data.video || {}) },
            wechat: { ...base.wechat, ...(data.wechat || {}) },
            cctv: { ...base.cctv, ...(data.cctv || {}) }
        };
        state.overviewRange = data.overviewRange || base.overviewRange;
        const range = normalizeCollectRange(data.collectRangeStart, data.collectRangeEnd);
        state.collectRangeStart = range.startValue;
        state.collectRangeEnd = range.endValue;
        state.topic.topics = Array.isArray(state.topic.topics) ? state.topic.topics : [];
        state.topic.results = Array.isArray(state.topic.results) ? state.topic.results : [];
        state.video.results = Array.isArray(state.video.results) ? state.video.results : [];
        state.wechat.results = Array.isArray(state.wechat.results) ? state.wechat.results : [];
        state.cctv.vids = Array.isArray(state.cctv.vids) ? state.cctv.vids : [];
        state.cctv.results = Array.isArray(state.cctv.results) ? state.cctv.results : [];
        const hasLegacyTopicQueue = state.topic.topics.some(item => !isValidTopicQueueItem(item));
        const hasLegacyTopicResults = state.topic.results.some(item => !isValidTopicResultItem(item));
        if (hasLegacyTopicQueue || hasLegacyTopicResults) {
            state.topic = { ...base.topic };
        } else {
            state.topic.topics = state.topic.topics.map(item => ({
                name: getTopicQueueItemName(item),
                sourcePublishTime: getTopicQueueItemSourceTime(item)
            }));
            state.topic.results = state.topic.results.map((item, idx) => ({
                ...item,
                '来源发布时间': String(item['来源发布时间']).trim(),
                序号: idx + 1
            }));
        }
        return state;
    }

    function saveState(state) {
        const val = JSON.stringify(state);
        if (typeof GM_setValue === 'function') {
            GM_setValue(STORAGE_KEY, val);
        } else {
            localStorage.setItem(STORAGE_KEY, val);
        }
    }


    function parseCount(text) {
        if (!text) return 0;
        const s = String(text).replace(/\s+/g, '').replace(/[,\uFF0C]/g, '').trim();
        if (s === '转发' || s === '评论' || s === '赞') return 0;
        const m = s.match(/([\d.]+)(万|亿)?/);
        if (!m) return 0;
        let num = parseFloat(m[1]);
        if (Number.isNaN(num)) return 0;
        if (m[2] === '万') num *= 10000;
        if (m[2] === '亿') num *= 100000000;
        return Math.round(num);
    }


    function showToast(msg) {
        const id = 'weibo-scraper-toast';
        const old = document.getElementById(id);
        if (old) old.remove();
        const div = document.createElement('div');
        div.id = id;
        div.textContent = msg;
        div.style.cssText = [
            'position: fixed',
            'left: 50%',
            'bottom: 18px',
            'transform: translateX(-50%)',
            'background: rgba(0,0,0,0.85)',
            'color: #fff',
            'padding: 12px 18px',
            'border-radius: 12px',
            'z-index: 2147483647',
            'font-size: 14px',
            'max-width: 90vw',
            'font-family: sans-serif'
        ].join(';');
        document.body.appendChild(div);
        setTimeout(() => div.remove(), 2500);
    }

    let busyOverlayRefs = null;

    function ensureBusyOverlay() {
        if (busyOverlayRefs && busyOverlayRefs.root && document.body.contains(busyOverlayRefs.root)) {
            return busyOverlayRefs;
        }

        const styleId = 'weibo-scraper-busy-style';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
                @keyframes weibo-scraper-busy-spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }

        const root = document.createElement('div');
        root.id = 'weibo-scraper-busy-overlay';
        root.style.cssText = [
            'position: fixed',
            'inset: 0',
            `z-index: ${OVERLAY_Z_INDEX}`,
            'display: none',
            'align-items: center',
            'justify-content: center',
            'padding: 24px',
            'background: rgba(7, 11, 18, 0.62)',
            'backdrop-filter: blur(4px)',
            'pointer-events: none'
        ].join(';');

        const card = document.createElement('div');
        card.style.cssText = [
            'width: min(460px, calc(100vw - 32px))',
            'border-radius: 22px',
            'padding: 22px 24px',
            'background: linear-gradient(160deg, rgba(12, 18, 28, 0.96), rgba(20, 30, 46, 0.92))',
            'border: 1px solid rgba(255,255,255,0.16)',
            'box-shadow: 0 24px 70px rgba(0,0,0,0.4)',
            'color: #eef4ff',
            'font-family: Trebuchet MS, Microsoft YaHei, sans-serif'
        ].join(';');

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;gap:14px;margin-bottom:16px;';

        const spinner = document.createElement('div');
        spinner.style.cssText = [
            'width: 18px',
            'height: 18px',
            'border-radius: 50%',
            'border: 2px solid rgba(255,255,255,0.22)',
            'border-top-color: #ff8a3d',
            'animation: weibo-scraper-busy-spin 1s linear infinite',
            'flex: 0 0 auto'
        ].join(';');

        const headerText = document.createElement('div');
        headerText.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

        const badge = document.createElement('div');
        badge.textContent = '执行中';
        badge.style.cssText = 'font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#ffb277;';

        const task = document.createElement('div');
        task.style.cssText = 'font-size:24px;font-weight:700;line-height:1.2;';

        const action = document.createElement('div');
        action.style.cssText = 'font-size:15px;line-height:1.6;color:rgba(255,255,255,0.9);';

        const detail = document.createElement('div');
        detail.style.cssText = 'margin-top:10px;font-size:13px;line-height:1.7;color:rgba(255,255,255,0.72);';

        const meta = document.createElement('div');
        meta.style.cssText = 'margin-top:14px;font-size:12px;line-height:1.6;color:#8ec5ff;';

        const note = document.createElement('div');
        note.textContent = '页面变暗是正常现象，右上角面板仍可随时停止。';
        note.style.cssText = 'margin-top:12px;font-size:12px;line-height:1.7;color:rgba(255,255,255,0.58);';

        headerText.appendChild(badge);
        headerText.appendChild(task);
        header.appendChild(spinner);
        header.appendChild(headerText);
        card.appendChild(header);
        card.appendChild(action);
        card.appendChild(detail);
        card.appendChild(meta);
        card.appendChild(note);
        root.appendChild(card);
        document.body.appendChild(root);

        busyOverlayRefs = { root, task, action, detail, meta };
        return busyOverlayRefs;
    }

    function getBusyTaskLabelByAction(action) {
        if (action === 'video') return '微博数据';
        if (action === 'topic') return '微博话题&热搜';
        return '数据采集';
    }

    function buildBusyOverlayMeta(state) {
        return `微博 ${state.video.results.length} 条 · 话题 ${state.topic.results.length} 条 · 央视频 ${state.cctv.results.length} 条`;
    }

    function showBusyOverlay(taskText, actionText, detailText) {
        const refs = ensureBusyOverlay();
        const state = loadState();
        refs.task.textContent = taskText || '数据采集';
        refs.action.textContent = actionText || '正在执行任务，请稍候';
        refs.detail.textContent = detailText || '页面没有死机，脚本仍在继续执行。';
        refs.meta.textContent = buildBusyOverlayMeta(state);
        refs.root.style.display = 'flex';
    }

    function hideBusyOverlay() {
        if (!busyOverlayRefs || !busyOverlayRefs.root) return;
        busyOverlayRefs.root.style.display = 'none';
    }

    function getBusyOverlayPayload(state) {
        if (state._pendingStart) {
            return {
                task: getBusyTaskLabelByAction(state._pendingStart),
                action: '正在进入目标页面',
                detail: '页面跳转完成后会自动开始采集。'
            };
        }

        if (state.video.running) {
            if (!isOnTargetUserPage()) {
                return {
                    task: '微博数据',
                    action: '正在进入微博主页',
                    detail: '准备开始采集微博内容。'
                };
            }
            const cardCount = document.querySelectorAll('.card9').length;
            return {
                task: '微博数据',
                action: cardCount ? '正在采集微博数据' : '正在等待微博内容加载',
                detail: cardCount
                    ? `当前页已加载 ${cardCount} 条微博卡片，脚本正在继续处理。`
                    : '首次进入页面或首屏补全文时会稍慢一些。'
            };
        }

        if (state.topic.running) {
            if (isOnDetailPage()) {
                return {
                    task: '微博话题&热搜',
                    action: '正在读取话题详情',
                    detail: `当前进度 ${Math.min(state.topic.idx + 1, state.topic.topics.length || 1)}/${state.topic.topics.length || 0}。`
                };
            }
            if (isOnTargetUserPage()) {
                return {
                    task: '微博话题&热搜',
                    action: '正在扫描微博列表',
                    detail: `已收集 ${state.topic.topics.length} 个话题候选，正在继续向下查找。`
                };
            }
            return {
                task: '微博话题&热搜',
                action: '正在进入微博主页',
                detail: '准备开始扫描话题和热搜数据。'
            };
        }

        if (state.cctv.running) {
            if (isOnCctvListPage()) {
                return {
                    task: '央视频数据',
                    action: '正在收集视频列表',
                    detail: `已发现 ${state.cctv.vids.length} 个视频候选，正在继续加载。`
                };
            }
            if (isOnCctvDetailPage() || isOnCctvMissingRoute()) {
                return {
                    task: '央视频数据',
                    action: '正在读取视频详情',
                    detail: `当前进度 ${Math.min(state.cctv.idx + 1, state.cctv.vids.length || 1)}/${state.cctv.vids.length || 0}。`
                };
            }
            return {
                task: '央视频数据',
                action: '正在进入央视频页面',
                detail: '准备开始采集央视频数据。'
            };
        }

        return null;
    }

    function syncBusyOverlay() {
        const state = loadState();
        const payload = getBusyOverlayPayload(state);
        if (!payload) {
            hideBusyOverlay();
            return;
        }
        showBusyOverlay(payload.task, payload.action, payload.detail);
    }

    function isOnTargetUserPage() {
        return location.hostname === 'm.weibo.cn' && location.pathname === `/u/${TARGET_UID}`;
    }

    function sleepHumanLike(baseMs, jitterMs) {
        const jitter = Math.floor(Math.random() * (jitterMs * 2 + 1)) - jitterMs;
        const next = Math.max(300, baseMs + jitter);
        return sleep(next);
    }

    function sleepRange(minMs, maxMs) {
        const span = Math.max(0, maxMs - minMs);
        const next = minMs + Math.floor(Math.random() * (span + 1));
        return sleep(next);
    }

    function getPublishTimeText(card) {
        if (!card) return '';
        const headerTime = card.querySelector('.weibo-top .time') || card.querySelector('header .time');
        let timeStr = headerTime ? headerTime.textContent.trim() : '';
        if (!timeStr) {
            const anyTime = card.querySelector('.time');
            timeStr = anyTime ? anyTime.textContent.trim() : '';
        }
        return timeStr;
    }

    function getVueCreatedAt(card) {
        // 从 Vue 组件获取真实发布时间
        if (card && card.__vue__ && card.__vue__.item && card.__vue__.item.created_at) {
            return card.__vue__.item.created_at;
        }
        return null;
    }

    function parseVueCreatedAt(createdAt) {
        // 解析 Vue 的 created_at 格式，如 "Thu Jan 29 14:23:46 +0800 2026"
        if (!createdAt) return null;
        const date = new Date(createdAt);
        if (isNaN(date.getTime())) return null;
        return date;
    }

    function formatVueCreatedAt(createdAt) {
        // 将 Vue 的 created_at 格式化为 "YYYY-MM-DD HH:MM:SS"
        const date = parseVueCreatedAt(createdAt);
        if (!date) return '';
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const hh = String(date.getHours()).padStart(2, '0');
        const mm = String(date.getMinutes()).padStart(2, '0');
        const ss = String(date.getSeconds()).padStart(2, '0');
        return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
    }

    function getCardPublishInfo(card) {
        const vueCreatedAt = getVueCreatedAt(card);
        if (vueCreatedAt) {
            const vueDate = parseVueCreatedAt(vueCreatedAt);
            if (vueDate) {
                return {
                    date: vueDate,
                    formatted: formatVueCreatedAt(vueCreatedAt)
                };
            }
        }
        const timeStr = getPublishTimeText(card);
        const timeDate = parseTimeToDate(timeStr);
        return {
            date: timeDate,
            formatted: timeDate ? parseTimeToAbsolute(timeStr) : ''
        };
    }

    function getOldestPublishDate(cards) {
        if (!cards || cards.length === 0) return null;
        let oldest = null;
        cards.forEach((card) => {
            const publishInfo = getCardPublishInfo(card);
            const date = publishInfo.date;
            if (!date) return;
            if (!oldest || date < oldest) oldest = date;
        });
        return oldest;
    }

    function isCollectionPageActive() {
        if (document.visibilityState && document.visibilityState !== 'visible') return false;
        if (typeof document.hasFocus === 'function' && !document.hasFocus()) return false;
        return true;
    }

    async function waitUntilCollectionPageActive(config) {
        let pausedShown = false;
        while (!isCollectionPageActive()) {
            const state = loadState();
            if (!state[config.stateKey].running) return state;
            if (!pausedShown) {
                showBusyOverlay(
                    config.overlay.task,
                    '页面不在前台，已暂停采集',
                    '请回到这个采集页面，脚本会自动继续。'
                );
                pausedShown = true;
            }
            await sleep(1000);
        }
        return loadState();
    }

    function createListProgressTracker() {
        return {
            lastSnapshot: '',
            repeatCount: 0
        };
    }

    function updateListProgressTracker(tracker, snapshot) {
        const nextSnapshot = String(snapshot ?? '');
        if (tracker.lastSnapshot === nextSnapshot) tracker.repeatCount += 1;
        else tracker.repeatCount = 0;
        tracker.lastSnapshot = nextSnapshot;
        return tracker.repeatCount;
    }

    async function maybePauseWeiboListByOldestDate(state, config) {
        const pause = config.pauseByDays;
        if (!pause) return state;
        const cards = Array.from(document.querySelectorAll(pause.cardSelector));
        const oldest = getOldestPublishDate(cards);
        if (!oldest) return state;
        const branch = state[config.stateKey];
        const oldestTime = oldest.getTime();
        const checkpoint = branch._pauseCheckpoint;
        if (typeof checkpoint !== 'number') {
            branch._pauseCheckpoint = oldestTime;
            saveState(state);
            return state;
        }
        const diffDays = Math.floor((checkpoint - oldestTime) / (24 * 60 * 60 * 1000));
        if (diffDays < pause.days) return state;
        branch._pauseCheckpoint = oldestTime;
        saveState(state);
        showToast(pause.toast);
        await sleepRange(pause.minMs, pause.maxMs);
        return loadState();
    }

    async function runWeiboListCollector(config) {
        let state = loadState();
        const runtime = typeof config.createRuntime === 'function' ? config.createRuntime(state) : {};
        while (state[config.stateKey].running) {
            if (!isCollectionPageActive()) {
                runtime.progressTracker = createListProgressTracker();
                state = await waitUntilCollectionPageActive(config);
                if (!state[config.stateKey].running) break;
            }

            const scan = await config.scan(state, runtime);
            saveState(state);

            if (typeof config.shouldStopAfterScan === 'function') {
                const stopSignal = config.shouldStopAfterScan(state, scan, runtime);
                if (stopSignal) {
                    if (stopSignal.toast) showToast(stopSignal.toast);
                    break;
                }
            }

            if (typeof config.getProgressSnapshot === 'function') {
                runtime.progressTracker = runtime.progressTracker || createListProgressTracker();
                const repeatCount = updateListProgressTracker(
                    runtime.progressTracker,
                    config.getProgressSnapshot(state, scan, runtime)
                );
                if (typeof config.shouldStopOnStall === 'function') {
                    const stallSignal = config.shouldStopOnStall(state, scan, runtime, repeatCount);
                    if (stallSignal) {
                        if (stallSignal.toast) showToast(stallSignal.toast);
                        break;
                    }
                }
            }

            state = await maybePauseWeiboListByOldestDate(state, config);
            if (!state[config.stateKey].running) break;

            await config.scroll(state, scan, runtime);
            await config.waitAfterScroll(state, scan, runtime);

            state = loadState();
            if (typeof config.onStateReload === 'function') {
                config.onStateReload(state, runtime);
            }
        }

        state = loadState();
        if (typeof config.finish === 'function') {
            const nextState = await config.finish(state, runtime);
            return nextState || loadState();
        }
        return state;
    }

    // ===== 话题采集逻辑 =====
    function normalizeTopicName(name) {
        if (!name) return '';
        let s = String(name).trim();
        if (s.startsWith('#')) s = s.slice(1);
        if (s.endsWith('#')) s = s.slice(0, -1);
        return s.trim();
    }

    function buildDetailUrl(topicName) {
        const q = '#' + topicName + '#';
        const qs = new URLSearchParams({
            showmenu: '0',
            topnavstyle: '1',
            immersiveScroll: '60',
            q
        });
        return `https://m.s.weibo.com/vtopic/detail_new?${qs.toString()}`;
    }

    function isOnDetailPage() {
        return location.hostname === 'm.s.weibo.com' && location.pathname.includes('/vtopic/detail_new');
    }

    function collectTopicsFromNode(node, sourcePublishTime, topicsMap) {
        const anchors = Array.from(node.querySelectorAll('a'));
        for (const a of anchors) {
            const t = (a.textContent || '').trim();
            if (!t) continue;
            const matches = t.match(/#[^#\s]{1,80}#/g);
            if (!matches) continue;
            for (const raw of matches) {
                const name = normalizeTopicName(raw);
                if (!name) continue;
                if (topicsMap.has(name)) continue;
                topicsMap.set(name, {
                    name,
                    sourcePublishTime
                });
            }
        }
    }

    function findAllTopicsInPage(state) {
        const topicsMap = new Map();
        let belowStartCount = 0;
        let inRangeCount = 0;
        const range = getCollectRange(state);
        const cards = Array.from(document.querySelectorAll('.card'));
        for (const card of cards) {
            if (card.dataset.topicScanned) continue;
            const publishInfo = getCardPublishInfo(card);
            if (!publishInfo.date || !publishInfo.formatted) {
                card.dataset.topicScanned = 'true';
                continue;
            }
            if (publishInfo.date < range.start) {
                belowStartCount += 1;
                card.dataset.topicScanned = 'true';
                continue;
            }
            if (publishInfo.date > range.end) {
                card.dataset.topicScanned = 'true';
                continue;
            }
            inRangeCount += 1;
            collectTopicsFromNode(card, publishInfo.formatted, topicsMap);
            card.dataset.topicScanned = 'true';
        }
        return {
            topics: Array.from(topicsMap.values()),
            reachedLimitCandidate: belowStartCount >= 5 && inRangeCount === 0
        };
    }

    function scanTopicListPage(state, runtime) {
        const scan = findAllTopicsInPage(state);
        let addedThisRound = 0;
        runtime.knownTopics = runtime.knownTopics || new Set();
        for (const item of scan.topics) {
            const name = getTopicQueueItemName(item);
            if (!name || runtime.knownTopics.has(name)) continue;
            state.topic.topics.push({
                name,
                sourcePublishTime: getTopicQueueItemSourceTime(item)
            });
            runtime.knownTopics.add(name);
            addedThisRound += 1;
        }
        if (scan.reachedLimitCandidate && addedThisRound === 0) runtime.limitHitStreak += 1;
        else runtime.limitHitStreak = 0;
        return {
            ...scan,
            addedThisRound
        };
    }

    async function scrollAndCollectTopics() {
        return runWeiboListCollector(getWeiboListCollectorConfig('topic'));
    }

    function getTopicFromDetailPage() {
        const header = document.querySelector('.topic-header-wrap .topic .text');
        if (header && header.textContent) return normalizeTopicName(header.textContent);
        const q = new URLSearchParams(location.search).get('q') || '';
        return normalizeTopicName(q);
    }

    function getHostFromDetailPage() {
        const el = document.querySelector('.data.host-data .name');
        if (el && el.textContent) return el.textContent.trim();
        return '';
    }

    function getOverviewMetricsRaw() {
        const panel = Array.from(document.querySelectorAll('.ui-pannel')).find(p => (p.textContent || '').includes('数据总览'));
        if (!panel) return {};
        const map = {};
        const cols = Array.from(panel.querySelectorAll('.detail-data .item-col'));
        for (const col of cols) {
            const des = col.querySelector('.des');
            const num = col.querySelector('.num');
            const k = des ? des.textContent.trim() : '';
            const v = num ? num.textContent.replace(/\s+/g, '').trim() : '';
            if (k) map[k] = v;
        }
        return map;
    }

    function getHotSearchPeak() {
        const panel = Array.from(document.querySelectorAll('.ui-pannel')).find(p => (p.textContent || '').includes('热搜记录'));
        if (!panel) return '';
        const blocks = Array.from(panel.querySelectorAll('.area_gray_col'));
        for (const block of blocks) {
            const label = block.querySelector('.area_gray_text');
            if (!label) continue;
            if ((label.textContent || '').trim() !== '热搜榜最高位置') continue;
            const pos = block.querySelector('.pos');
            if (!pos) return '';
            return (pos.textContent || '').trim();
        }
        return '';
    }

    function getOverviewRangeLabel(range) {
        if (range === 'all') return '全部';
        if (range === '24h') return '24小时';
        return '30天';
    }

    function findOverviewRangeTab(range) {
        const panel = Array.from(document.querySelectorAll('.ui-pannel')).find(p => (p.textContent || '').includes('数据总览'));
        if (!panel) return null;
        const tabs = Array.from(panel.querySelectorAll('.tab .tab_text'));
        const label = getOverviewRangeLabel(range);
        return tabs.find(t => (t.textContent || '').trim() === label) || null;
    }

    function isOverviewRangeActive(range) {
        const tab = findOverviewRangeTab(range);
        if (!tab) return false;
        return tab.classList.contains('active');
    }

    async function waitFor(cond, timeoutMs) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (cond()) return true;
            await sleep(200);
        }
        return false;
    }

    async function ensureOverviewRangeSelected(range) {
        await waitFor(() => !!findOverviewRangeTab(range), 8000);
        const wasActive = isOverviewRangeActive(range);
        if (!wasActive) {
            const tab = findOverviewRangeTab(range);
            if (tab) tab.click();
            await waitFor(() => isOverviewRangeActive(range), 8000);
        }
        await waitFor(() => {
            const metrics = getOverviewMetricsRaw();
            return !!metrics && Object.keys(metrics).length > 0;
        }, 2500);
    }
    function upsertTopicResult(state, row) {
        const targetName = row['话题名称'] || '';
        const targetPublishTime = row['来源发布时间'] || '';
        const index = state.topic.results.findIndex((item) => (
            item
            && item['话题名称'] === targetName
            && item['来源发布时间'] === targetPublishTime
        ));
        if (index >= 0) {
            state.topic.results[index] = {
                ...state.topic.results[index],
                ...row
            };
        } else {
            state.topic.results.push(row);
        }
        state.topic.results.forEach((item, idx) => {
            item.序号 = idx + 1;
        });
    }

    function pushResultFromDetailPage(state, expectedTopicItem) {
        const topic = getTopicFromDetailPage();
        const host = getHostFromDetailPage();
        const metrics = getOverviewMetricsRaw();
        const hotSearchPeak = getHotSearchPeak();
        const sourcePublishTime = getTopicQueueItemSourceTime(expectedTopicItem);

        const readRaw = metrics['阅读量'] || '';
        const discussRaw = metrics['讨论量'] || '';

        const row = {
            序号: 0,
            话题名称: topic || '',
            话题主持人: host || '',
            话题阅读量: parseCount(readRaw),
            话题讨论量: parseCount(discussRaw),
            热搜记录: hotSearchPeak,
            抓取时间: nowStr(),
            来源发布时间: sourcePublishTime
        };

        if (row.话题主持人 !== '央视军事') return null;
        upsertTopicResult(state, row);
        return row;
    }

    async function runTopicDetailStep() {
        let state = loadState();
        if (!state.topic.running || !isOnDetailPage()) return;

        try {
            state = loadState();
            if (!state.topic.running) return;
            const expectedTopicItem = state.topic.topics[state.topic.idx];
            const expectedTopicName = getTopicQueueItemName(expectedTopicItem);
            const currentTopicName = getTopicFromDetailPage();
            if (!currentTopicName) {
                throw new Error('未识别到当前话题');
            }
            if (!expectedTopicName) {
                throw new Error('当前话题队列无效');
            }
            if (currentTopicName !== expectedTopicName) {
                location.href = buildDetailUrl(expectedTopicName);
                return;
            }
            await ensureOverviewRangeSelected(state.overviewRange || DEFAULT_OVERVIEW_RANGE);
            await sleepHumanLike(220, 140);

            state = loadState();
            if (!state.topic.running) return;
            const currentTopicItem = state.topic.topics[state.topic.idx];
            const row = pushResultFromDetailPage(state, currentTopicItem);
            if (row && row.话题名称) {
                saveState(state);
            }

            state = loadState();
            if (!state.topic.running) return;
            state.topic.idx++;
            saveState(state);

            if (state.topic.idx >= state.topic.topics.length) {
                state.topic.running = false;
                saveState(state);
                showToast(`话题采集完成：${state.topic.results.length}条`);
            } else {
                // 每采集 TOPIC_BATCH_SIZE 个话题后长休息
                if (state.topic.idx > 0 && state.topic.idx % TOPIC_BATCH_SIZE === 0) {
                    showToast(`已采集${state.topic.idx}个话题，休息4-8秒防风控`);
                    await sleepRange(TOPIC_BATCH_REST_MIN, TOPIC_BATCH_REST_MAX);
                    state = loadState();
                    if (!state.topic.running) return;
                }
                // 话题之间保留轻微随机停顿，避免跳转过于机械
                await sleepRange(TOPIC_JUMP_DELAY_MIN, TOPIC_JUMP_DELAY_MAX);
                location.href = buildDetailUrl(getTopicQueueItemName(state.topic.topics[state.topic.idx]));
            }
        } catch (e) {
            console.error('话题采集失败', e);
            showToast('话题抓取失败，已跳过');
            state = loadState();
            if (!state.topic.running) return;
            state.topic.idx++;
            saveState(state);
            if (state.topic.idx < state.topic.topics.length) {
                await sleepRange(TOPIC_JUMP_DELAY_MIN, TOPIC_JUMP_DELAY_MAX);
                location.href = buildDetailUrl(getTopicQueueItemName(state.topic.topics[state.topic.idx]));
            } else {
                state.topic.running = false;
                saveState(state);
            }
        }
    }

    async function continueTopicCollectFromUserPage() {
        let state = loadState();
        if (!state.topic.running) return;
        if (!isOnTargetUserPage()) return;
        state.topic.step = 'collecting';
        saveState(state);
        const s = await scrollAndCollectTopics();
        if (s.topic.running && s.topic.topics.length > 0) {
            const target = s.topic.topics[s.topic.idx] || s.topic.topics[0];
            location.href = buildDetailUrl(getTopicQueueItemName(target));
        } else if (s.topic.topics.length === 0) {
            showToast('没找到话题');
            const latest = loadState();
            latest.topic.running = false;
            saveState(latest);
        }
    }

    function resumeTopicIfNeeded() {
        const state = loadState();
        if (!state.topic.running) return;
        if (isOnDetailPage()) {
            runTopicDetailStep();
            return;
        }
        if (state.topic.topics.length > 0) {
            if (state.topic.idx >= state.topic.topics.length) {
                state.topic.running = false;
                saveState(state);
                showToast('话题采集已完成');
                return;
            }
            location.href = buildDetailUrl(getTopicQueueItemName(state.topic.topics[state.topic.idx]));
            return;
        }
        if (isOnTargetUserPage()) {
            continueTopicCollectFromUserPage();
            return;
        }
        location.href = TARGET_USER_URL;
    }

    // ===== 微博采集逻辑 =====
    function parseTimeToAbsolute(timeStr) {
        const now = new Date();
        let date = new Date(now);
        if (timeStr.includes('刚刚')) {
            // 当前时间
        } else if (timeStr.includes('分钟前')) {
            const mins = parseInt(timeStr) || 0;
            date.setMinutes(date.getMinutes() - mins);
        } else if (timeStr.includes('小时前')) {
            const hours = parseInt(timeStr) || 0;
            date.setHours(date.getHours() - hours);
        } else if (timeStr.includes('昨天')) {
            date.setDate(date.getDate() - 1);
            const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})/);
            if (timeMatch) {
                date.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0);
            }
        } else if (timeStr.includes('天前')) {
            const days = parseInt(timeStr) || 0;
            date.setDate(date.getDate() - days);
        } else {
            const fullMatch = timeStr.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
            const shortMatch = timeStr.match(/(\d{1,2})-(\d{1,2})/);
            const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})/);
            if (fullMatch) {
                date = new Date(parseInt(fullMatch[1]), parseInt(fullMatch[2]) - 1, parseInt(fullMatch[3]));
            } else if (shortMatch) {
                const month = parseInt(shortMatch[1]) - 1;
                const day = parseInt(shortMatch[2]);
                const year = now.getMonth() < month ? now.getFullYear() - 1 : now.getFullYear();
                date = new Date(year, month, day);
            }
            if (timeMatch) {
                date.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0);
            }
        }
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }

    function parseDateTimeString(value) {
        if (!value) return null;
        const s = String(value).trim();
        const m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
        if (m) {
            return new Date(
                parseInt(m[1], 10),
                parseInt(m[2], 10) - 1,
                parseInt(m[3], 10),
                parseInt(m[4], 10),
                parseInt(m[5], 10),
                parseInt(m[6] || '0', 10)
            );
        }
        return parseDateOnlyString(s);
    }

    function parseDateOnlyString(value) {
        if (!value) return null;
        const s = String(value).trim();
        const full = s.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
        if (full) {
            return new Date(
                parseInt(full[1], 10),
                parseInt(full[2], 10) - 1,
                parseInt(full[3], 10),
                0, 0, 0
            );
        }
        const short = s.match(/(\d{1,2})-(\d{1,2})/);
        if (short) {
            const now = new Date();
            const month = parseInt(short[1], 10) - 1;
            const day = parseInt(short[2], 10);
            const year = now.getMonth() < month ? now.getFullYear() - 1 : now.getFullYear();
            return new Date(year, month, day, 0, 0, 0);
        }
        return null;
    }

    function parseTimeToDate(timeStr) {
        if (!timeStr) return null;
        const abs = parseTimeToAbsolute(timeStr);
        return parseDateTimeString(abs);
    }

    function getCollectRange(state) {
        const range = normalizeCollectRange(state.collectRangeStart, state.collectRangeEnd);
        if (state.collectRangeStart !== range.startValue || state.collectRangeEnd !== range.endValue) {
            state.collectRangeStart = range.startValue;
            state.collectRangeEnd = range.endValue;
            saveState(state);
        }
        return { start: range.start, end: range.end };
    }

    function isDateWithinRange(date, start, end) {
        if (!date) return false;
        return date >= start && date <= end;
    }

    function isDateOnlyWithinRange(dateStr, start, end) {
        const date = parseDateOnlyString(dateStr);
        if (!date) return false;
        const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
        return date >= startDay && date <= endDay;
    }

    function compareDateOnlyToRange(dateStr, start, end) {
        const date = parseDateOnlyString(dateStr);
        if (!date) return 'unknown';
        const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
        if (date < startDay) return 'before';
        if (date > endDay) return 'after';
        return 'within';
    }

    function normalizeWeiboText(raw, removeFullTextHint) {
        if (!raw && raw !== 0) return '';
        let text = String(raw);
        if (removeFullTextHint) {
            text = text.replace(/\s*全文\s*$/, '');
        }
        return text.replace(/\s+/g, ' ').trim();
    }

    function htmlToText(html) {
        if (!html) return '';
        const div = document.createElement('div');
        div.innerHTML = html;
        return div.textContent || '';
    }

    function extractWeiboIdFromLink(link) {
        if (!link) return '';
        const m = String(link).match(/\/status\/(\d+)/);
        return m ? m[1] : '';
    }

    function findFullTextLink(card) {
        if (!card) return null;
        const links = Array.from(card.querySelectorAll('.weibo-text a'));
        return links.find(a => (a.textContent || '').trim() === '全文') || null;
    }

    async function fetchWeiboFullTextById(weiboId) {
        if (!weiboId) return '';
        if (WEIBO_TEXT_CACHE.has(weiboId)) return WEIBO_TEXT_CACHE.get(weiboId);
        await sleepRange(1000, 3000);
        let text = '';
        try {
            const resp = await fetch(`https://m.weibo.cn/statuses/show?id=${weiboId}`, {
                credentials: 'same-origin',
                headers: {
                    'Referer': 'https://m.weibo.cn/',
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });
            if (!resp.ok) return '';
            const data = await resp.json();
            const raw = data?.data?.text_raw || '';
            if (raw) {
                text = normalizeWeiboText(raw, false);
            } else if (data?.data?.text) {
                text = normalizeWeiboText(htmlToText(data.data.text), false);
            }
            if (text) WEIBO_TEXT_CACHE.set(weiboId, text);
        } catch (e) {
            return '';
        }
        return text;
    }

    async function extractWeiboFullText(card) {
        const textEl = card ? card.querySelector('.weibo-text') : null;
        const hasFullLink = !!findFullTextLink(card);
        const fallback = normalizeWeiboText(textEl ? textEl.textContent : '', hasFullLink);
        if (!hasFullLink) return fallback;
        const link = buildWeiboLink(card);
        const weiboId = extractWeiboIdFromLink(link);
        if (!weiboId) return fallback;
        const fullText = await fetchWeiboFullTextById(weiboId);
        if (fullText) return fullText;
        if (!WEIBO_TEXT_CACHE.has(weiboId)) WEIBO_TEXT_CACHE.set(weiboId, fallback);
        return fallback;
    }

    function buildWeiboLink(card) {
        // 优先从 Vue 组件读取微博 ID
        if (card.__vue__ && card.__vue__.item && card.__vue__.item.id) {
            return `https://m.weibo.cn/status/${card.__vue__.item.id}`;
        }
        const cardWrap = card.closest('[data-id]') || card.querySelector('[data-id]');
        if (cardWrap && cardWrap.dataset.id) {
            return `https://m.weibo.cn/status/${cardWrap.dataset.id}`;
        }
        const fullTextLink = card.querySelector('a[href*="/status/"]');
        if (fullTextLink && fullTextLink.href) {
            return fullTextLink.href;
        }
        const allLinks = card.querySelectorAll('a[href]');
        for (const link of allLinks) {
            const match = link.href.match(/\/status\/(\d+)/);
            if (match) return `https://m.weibo.cn/status/${match[1]}`;
        }
        return '';
    }

    async function collectVideoData(state) {
        const cards = document.querySelectorAll('.card9');
        let addedCount = 0;
        let reachedStartBoundary = false;
        const existingLinks = new Set(state.video.results.map(r => r.链接));
        const range = getCollectRange(state);

        for (const card of cards) {
            if (card.dataset.scraped) continue;

            // 优先从 Vue 获取真实时间，否则从页面元素获取
            const vueCreatedAt = getVueCreatedAt(card);
            const vueDate = parseVueCreatedAt(vueCreatedAt);
            const timeStr = getPublishTimeText(card);
            const timeDate = vueDate || parseTimeToDate(timeStr);

            if (timeDate) {
                if (timeDate < range.start) {
                    reachedStartBoundary = true;
                    card.dataset.scraped = 'true';
                    continue;
                }
                if (timeDate > range.end) {
                    card.dataset.scraped = 'true';
                    continue;
                }
            }

            const link = buildWeiboLink(card);
            if (!link || existingLinks.has(link)) {
                card.dataset.scraped = 'true';
                continue;
            }

            const videoEl = card.querySelector('.card-video');
            let playCount = '';
            if (videoEl) {
                const playCountEl = videoEl.querySelector('.m-box-col');
                const playCountStr = playCountEl ? playCountEl.textContent.trim() : '';
                const parsed = parseCount(playCountStr.replace('次播放', ''));
                playCount = parsed || 0;
            }

            const footer = card.querySelector('footer');
            const btns = footer ? footer.querySelectorAll('.m-diy-btn h4') : [];
            const forward = btns[0] ? parseCount(btns[0].textContent) : 0;
            const comment = btns[1] ? parseCount(btns[1].textContent) : 0;
            const like = btns[2] ? parseCount(btns[2].textContent) : 0;

            const title = await extractWeiboFullText(card);
            // 优先使用 Vue 的真实时间
            const formattedTime = vueCreatedAt ? formatVueCreatedAt(vueCreatedAt) : parseTimeToAbsolute(timeStr);

            state.video.results.push({
                序号: state.video.results.length + 1,
                标题: title,
                链接: link,
                发布时间: formattedTime,
                转发量: forward,
                点赞量: like,
                评论量: comment,
                视频播放量: playCount
            });

            addedCount += 1;
            card.dataset.scraped = 'true';
            existingLinks.add(link);
        }

        return {
            reachedStartBoundary,
            addedCount
        };
    }

    function getWeiboListCollectorConfig(action) {
        if (action === 'topic') {
            return {
                action,
                stateKey: 'topic',
                stopToast: '已停止话题采集',
                overlay: {
                    task: '微博话题&热搜',
                    action: '正在开始采集',
                    detail: '正在准备扫描微博列表。'
                },
                prepareState(state) {
                    state.topic.running = true;
                    state.topic.idx = 0;
                    state.topic.topics = [];
                    state.topic.results = [];
                    state.topic.step = 'collecting';
                    delete state.topic._pauseCheckpoint;
                },
                createRuntime(state) {
                    return {
                        knownTopics: new Set(state.topic.topics.map(item => getTopicQueueItemName(item))),
                        limitHitStreak: 0,
                        progressTracker: createListProgressTracker()
                    };
                },
                scan: scanTopicListPage,
                shouldStopAfterScan(state, scan, runtime) {
                    return runtime.limitHitStreak >= 2 ? {} : null;
                },
                getProgressSnapshot() {
                    return `${document.querySelectorAll('.card').length}|${document.body.scrollHeight}`;
                },
                shouldStopOnStall(state, scan, runtime, repeatCount) {
                    return repeatCount >= NO_NEW_RETRY_LIMIT ? {} : null;
                },
                pauseByDays: {
                    cardSelector: '.card',
                    days: 5,
                    minMs: TOPIC_SCROLL_BREAK_REST_MIN,
                    maxMs: TOPIC_SCROLL_BREAK_REST_MAX,
                    toast: '已翻过5天，休息3-5.5秒后继续'
                },
                scroll() {
                    return topicScrollToBottom();
                },
                waitAfterScroll() {
                    return sleepHumanLike(TOPIC_SCROLL_WAIT_MS, 350);
                },
                onStateReload(state, runtime) {
                    runtime.knownTopics = new Set(state.topic.topics.map(item => getTopicQueueItemName(item)));
                },
                afterRun(state) {
                    if (state.topic.running && state.topic.topics.length > 0) {
                        showBusyOverlay('微博话题&热搜', '正在打开首个话题详情', '准备进入话题详情页继续采集。');
                        location.href = buildDetailUrl(getTopicQueueItemName(state.topic.topics[0]));
                    } else if (state.topic.topics.length === 0) {
                        showToast('没找到话题');
                        const latest = loadState();
                        latest.topic.running = false;
                        saveState(latest);
                        hideBusyOverlay();
                    }
                },
                onStop(state) {
                    state.topic.step = 'idle';
                }
            };
        }

        if (action === 'video') {
            return {
                action,
                stateKey: 'video',
                stopToast: '已停止微博采集',
                overlay: {
                    task: '微博数据',
                    action: '正在开始采集',
                    detail: '正在准备读取当前微博页面。'
                },
                prepareState(state) {
                    state.video.running = true;
                    state.video.results = [];
                    delete state.video._pauseCheckpoint;
                    delete state.video._lastCardCount;
                    delete state.video._noNewRetry;
                },
                createRuntime() {
                    return {
                        progressTracker: createListProgressTracker()
                    };
                },
                scan: collectVideoData,
                shouldStopAfterScan(state, scan) {
                    return scan.reachedStartBoundary ? { toast: '已超过开始时间，微博采集结束' } : null;
                },
                getProgressSnapshot() {
                    return document.querySelectorAll('.card9').length;
                },
                shouldStopOnStall(state, scan, runtime, repeatCount) {
                    return repeatCount > 5 ? { toast: '没有更多内容，微博采集结束' } : null;
                },
                pauseByDays: {
                    cardSelector: '.card9',
                    days: 5,
                    minMs: 20000,
                    maxMs: 30000,
                    toast: '已翻过5天，休息20-30秒后继续'
                },
                scroll() {
                    return humanScrollToBottom();
                },
                waitAfterScroll() {
                    return sleepHumanLike(2800, 1000);
                },
                async finish(state) {
                    const stoppedByUser = !state.video.running;
                    state.video.running = false;
                    delete state.video._lastCardCount;
                    delete state.video._noNewRetry;
                    delete state.video._pauseCheckpoint;
                    saveState(state);
                    if (!stoppedByUser) {
                        showToast(`微博采集完成：${state.video.results.length}条`);
                    }
                    return state;
                }
            };
        }

        return null;
    }

    function startWeiboListCollection(action) {
        const config = getWeiboListCollectorConfig(action);
        if (!config) return Promise.resolve(loadState());
        const state = loadState();
        config.prepareState(state);
        saveState(state);
        showBusyOverlay(config.overlay.task, config.overlay.action, config.overlay.detail);
        const task = runWeiboListCollector(config);
        if (typeof config.afterRun === 'function') {
            task.then((nextState) => {
                config.afterRun(nextState);
            });
        }
        return task;
    }

    function stopWeiboListCollection(action) {
        const config = getWeiboListCollectorConfig(action);
        if (!config) return;
        const state = loadState();
        state[config.stateKey].running = false;
        if (typeof config.onStop === 'function') {
            config.onStop(state);
        }
        saveState(state);
        showToast(config.stopToast);
        hideBusyOverlay();
    }

    // ===== 央视频采集逻辑 =====
    function isOnCctvListPage() {
        if (location.hostname !== 'w.yangshipin.cn') return false;
        if (location.pathname !== '/user') return false;
        const cpid = new URLSearchParams(location.search).get('cpid');
        return cpid === CCTV_CPID;
    }

    function isOnCctvDetailPage() {
        return location.hostname === 'yangshipin.cn' && location.pathname.startsWith('/video/home');
    }

    function isOnCctvMissingRoute() {
        return location.hostname === 'yangshipin.cn' && location.pathname === '/no_video';
    }

    function buildCctvDetailUrl(vid) {
        return `${CCTV_DETAIL_BASE}${vid}`;
    }

    function readCctvStateFromScripts() {
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const s of scripts) {
            const text = s.textContent || '';
            const idx = text.indexOf('window.__STATE_user__=');
            if (idx === -1) continue;
            let i = idx + 'window.__STATE_user__='.length;
            while (i < text.length && /\s/.test(text[i])) i++;
            if (text[i] !== '{') continue;
            let brace = 0;
            for (let j = i; j < text.length; j++) {
                const ch = text[j];
                if (ch === '{') brace++;
                else if (ch === '}') brace--;
                if (brace === 0) {
                    const jsonText = text.slice(i, j + 1);
                    return safeJsonParse(jsonText, null);
                }
            }
        }
        return null;
    }

    function extractCctvVidFromLink(link) {
        if (!link) return '';
        const m = String(link).match(/[?&]vid=([a-zA-Z0-9]+)/);
        return m ? m[1] : '';
    }

    function collectCctvVidsFromListDom() {
        const set = new Set();
        const items = Array.from(document.querySelectorAll('.p-user-list-item'));
        for (const item of items) {
            const trace = item.getAttribute('data-trace') || '';
            const traceMatch = trace.match(/fval1:([a-zA-Z0-9]+)/);
            if (traceMatch && traceMatch[1]) set.add(traceMatch[1]);

            const anchors = Array.from(item.querySelectorAll('a[href]'));
            for (const a of anchors) {
                const vid = extractCctvVidFromLink(a.getAttribute('href') || '');
                if (vid) set.add(vid);
            }

            const imgs = Array.from(item.querySelectorAll('img[data-src], img[src]'));
            for (const img of imgs) {
                const src = img.getAttribute('data-src') || img.getAttribute('src') || '';
                const imgMatch = src.match(/videoPic\/([a-zA-Z0-9]+)\//);
                if (imgMatch && imgMatch[1]) set.add(imgMatch[1]);
            }
        }
        return Array.from(set);
    }

    function collectCctvVidsFromState() {
        const data = window.__STATE_user__ || readCctvStateFromScripts();
        const list = data?.payloads?.userShareData?.video_list
            || data?.payloads?.userShareData?.cnt_info?.video_list
            || [];
        const set = new Set();
        for (const item of list) {
            const vid = item?.vid || extractCctvVidFromLink(item?.h5Link);
            if (vid) set.add(vid);
        }
        const domVids = collectCctvVidsFromListDom();
        domVids.forEach(vid => set.add(vid));
        return Array.from(set);
    }

    function mergeCctvVids(state) {
        const list = collectCctvVidsFromState();
        for (const vid of list) {
            if (!state.cctv.vids.includes(vid)) {
                state.cctv.vids.push(vid);
            }
        }
    }

    async function scrollAndCollectCctvVids(state) {
        state.cctv.step = 'collecting';
        saveState(state);

        let lastCount = state.cctv.vids.length;
        let noNew = 0;
        let rounds = 0;

        while (state.cctv.running) {
            if (!isCollectionPageActive()) {
                state = await waitUntilCollectionPageActive({
                    stateKey: 'cctv',
                    overlay: { task: '央视频数据' }
                });
                if (!state.cctv.running) break;
            }
            await waitFor(() => !!(window.__STATE_user__ || readCctvStateFromScripts()), 8000);
            mergeCctvVids(state);
            saveState(state);

            if (state.cctv.vids.length === lastCount) noNew += 1;
            else noNew = 0;
            lastCount = state.cctv.vids.length;

            if (noNew >= 3) break;

            rounds += 1;
            if (rounds >= 10) break;

            await scrollToLoadMore(1);
            await sleepHumanLike(1200, 600);
            state = loadState();
        }

        state = loadState();
        state.cctv.step = 'ready';
        saveState(state);
        return state;
    }

    function parseCctvDetailInfo() {
        const titleEl = document.querySelector('.video-main-l-title .title');
        const title = titleEl ? titleEl.textContent.trim() : '';
        const timeEl = document.querySelector('.video-main-l-time');
        const timeText = timeEl ? timeEl.textContent.replace(/\s+/g, ' ').trim() : '';
        const dateMatch = timeText.match(/(\d{4}-\d{1,2}-\d{1,2})/);
        const playMatch = timeText.match(/([\d.]+)(万|亿)?次观看/);
        const playCount = playMatch ? parseCount(`${playMatch[1]}${playMatch[2] || ''}`) : 0;
        const likeEl = document.querySelector('.icon .zan .fontSetRedHover');
        const likeCount = likeEl ? parseCount(likeEl.textContent) : 0;
        return {
            title,
            date: dateMatch ? dateMatch[1] : '',
            playCount,
            likeCount
        };
    }

    function getCurrentCctvVid() {
        try {
            const vid = new URL(location.href).searchParams.get('vid');
            return vid ? String(vid).trim() : '';
        } catch (e) {
            return extractCctvVidFromLink(location.href);
        }
    }

    function isCctvMissingPage() {
        if (isOnCctvMissingRoute()) return true;
        const text = document.body ? (document.body.textContent || '') : '';
        return /视频不见了|去看看其他的吧/.test(text);
    }

    function upsertCctvResult(state, row) {
        const rowVid = row['视频ID'] || '';
        const rowLink = row['链接'] || '';
        const index = state.cctv.results.findIndex((item) => (
            item
            && (
                (rowVid && item['视频ID'] === rowVid)
                || (rowLink && item['链接'] === rowLink)
            )
        ));
        if (index >= 0) {
            state.cctv.results[index] = {
                ...state.cctv.results[index],
                ...row
            };
        } else {
            state.cctv.results.push(row);
        }
        state.cctv.results.forEach((item, idx) => {
            item.序号 = idx + 1;
        });
    }

    function skipCurrentCctvAndContinue(state, toastMsg) {
        state.cctv.idx += 1;
        saveState(state);
        if (state.cctv.idx >= state.cctv.vids.length) {
            state.cctv.running = false;
            saveState(state);
            showToast(`央视频采集完成：${state.cctv.results.length}条`);
            location.href = CCTV_LIST_URL;
            return;
        }
        if (toastMsg) showToast(toastMsg);
        location.href = buildCctvDetailUrl(state.cctv.vids[state.cctv.idx]);
    }

    async function runCctvListStep() {
        let state = loadState();
        if (!state.cctv.running || !isOnCctvListPage()) return;

        if (state.cctv.step !== 'ready') {
            state = await scrollAndCollectCctvVids(state);
        }

        state = loadState();
        if (!state.cctv.running) return;

        if (state.cctv.vids.length === 0) {
            state.cctv.running = false;
            saveState(state);
            showToast('没找到央视频');
            return;
        }

        if (state.cctv.idx >= state.cctv.vids.length) {
            state.cctv.running = false;
            saveState(state);
            showToast(`央视频采集完成：${state.cctv.results.length}条`);
            return;
        }

        const vid = state.cctv.vids[state.cctv.idx];
        location.href = buildCctvDetailUrl(vid);
    }

    async function runCctvDetailStep() {
        let state = loadState();
        if (!state.cctv.running || (!isOnCctvDetailPage() && !isOnCctvMissingRoute())) return;

        await waitFor(() => {
            if (isCctvMissingPage()) return true;
            const t = document.querySelector('.video-main-l-title .title');
            const timeEl = document.querySelector('.video-main-l-time');
            return !!(t && t.textContent.trim() && timeEl);
        }, 8000);

        state = loadState();
        if (!state.cctv.running) return;
        const expectedVid = state.cctv.vids[state.cctv.idx] || '';
        if (!expectedVid) {
            state.cctv.running = false;
            saveState(state);
            location.href = CCTV_LIST_URL;
            return;
        }
        if (isCctvMissingPage()) {
            skipCurrentCctvAndContinue(state, '视频不存在，已跳过');
            return;
        }
        const currentVid = getCurrentCctvVid();
        if (currentVid !== expectedVid) {
            location.href = buildCctvDetailUrl(expectedVid);
            return;
        }

        const info = parseCctvDetailInfo();
        const range = getCollectRange(state);
        const rangeStatus = info.date
            ? compareDateOnlyToRange(info.date, range.start, range.end)
            : 'unknown';

        if (rangeStatus === 'before') {
            state.cctv.running = false;
            saveState(state);
            showToast(`已到开始时间之前，央视频采集停止：${state.cctv.results.length}条`);
            location.href = CCTV_LIST_URL;
            return;
        }

        if (rangeStatus === 'within' && info.title) {
            upsertCctvResult(state, {
                序号: state.cctv.results.length + 1,
                标题: info.title,
                链接: buildCctvDetailUrl(currentVid),
                发布时间: info.date || '',
                播放量: info.playCount,
                点赞量: Number.isFinite(info.likeCount) ? info.likeCount : 0,
                视频ID: currentVid
            });
        }

        state.cctv.idx += 1;
        saveState(state);

        if (state.cctv.idx >= state.cctv.vids.length) {
            state.cctv.running = false;
            saveState(state);
            showToast(`央视频采集完成：${state.cctv.results.length}条`);
            location.href = CCTV_LIST_URL;
            return;
        }

        location.href = CCTV_LIST_URL;
    }

    // ===== 微信CSV导入 =====
    function stripBom(text) {
        if (!text) return '';
        return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    }

    function parseCsvRows(text) {
        const rows = [];
        let row = [];
        let field = '';
        let inQuote = false;
        const src = stripBom(String(text || ''));
        for (let i = 0; i < src.length; i++) {
            const ch = src[i];
            if (inQuote) {
                if (ch === '"') {
                    if (src[i + 1] === '"') {
                        field += '"';
                        i++;
                    } else {
                        inQuote = false;
                    }
                } else {
                    field += ch;
                }
            } else {
                if (ch === '"') {
                    inQuote = true;
                } else if (ch === ',') {
                    row.push(field);
                    field = '';
                } else if (ch === '\n') {
                    row.push(field);
                    field = '';
                    if (row.length > 1 || (row[0] || '').trim() !== '') rows.push(row);
                    row = [];
                } else if (ch === '\r') {
                    continue;
                } else {
                    field += ch;
                }
            }
        }
        row.push(field);
        if (row.length > 1 || (row[0] || '').trim() !== '') rows.push(row);
        return rows;
    }

    function buildWechatRowsFromCsv(text) {
        const rows = parseCsvRows(text);
        if (rows.length === 0) return [];
        const header = rows[0].map(h => String(h || '').trim());
        const headerMap = {};
        header.forEach((h, i) => { if (h) headerMap[h] = i; });
        const getVal = (r, name) => {
            const idx = headerMap[name];
            return idx === undefined ? '' : (r[idx] || '');
        };
        const dataRows = rows.slice(1).filter(r => r.some(v => String(v || '').trim() !== ''));
        const result = [];
        dataRows.forEach((r, i) => {
            const title = getVal(r, '标题');
            const link = getVal(r, '链接') || getVal(r, '长链接');
            const date = getVal(r, '日期');
            const read = parseCount(getVal(r, '阅读数'));
            const like = parseCount(getVal(r, '点赞数'));
            const watch = parseCount(getVal(r, '推荐数'));
            result.push({
                序号: i + 1,
                标题: title || '',
                链接: link || '',
                发布时间: date || '',
                阅读量: read || 0,
                点赞量: like || 0,
                在看量: watch || 0
            });
        });
        return result;
    }

    function importWechatFromFile(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const text = reader.result || '';
                const results = buildWechatRowsFromCsv(text);
                const state = loadState();
                state.wechat.results = results;
                saveState(state);
                showToast(`微信导入完成：${results.length}条`);
            } catch (e) {
                console.error('微信CSV解析失败', e);
                showToast('微信CSV解析失败');
            }
        };
        reader.onerror = () => showToast('读取CSV失败');
        reader.readAsText(file);
    }

    function reindexResults(items) {
        return (items || []).map((item, idx) => ({ ...item, 序号: idx + 1 }));
    }

    function filterVideoResultsByRange(results, range) {
        const filtered = (results || []).filter((item) => {
            const dt = parseDateTimeString(item['发布时间']);
            return dt && isDateWithinRange(dt, range.start, range.end);
        });
        return reindexResults(filtered);
    }

    function filterTopicResultsByRange(results, range) {
        const filtered = (results || []).filter((item) => {
            const dt = parseDateTimeString(item['来源发布时间']);
            return dt && isDateWithinRange(dt, range.start, range.end);
        });
        return reindexResults(filtered);
    }

    function filterWechatResultsByRange(results, range) {
        const filtered = (results || []).filter((item) => {
            const timeStr = item['发布时间'] || '';
            const hasTime = /\d{1,2}:\d{2}/.test(timeStr);
            if (hasTime) {
                const dt = parseDateTimeString(timeStr);
                return dt && isDateWithinRange(dt, range.start, range.end);
            }
            return isDateOnlyWithinRange(timeStr, range.start, range.end);
        });
        return reindexResults(filtered);
    }

    function filterCctvResultsByRange(results, range) {
        const filtered = (results || []).filter((item) => {
            const dateStr = item['发布时间'] || '';
            return isDateOnlyWithinRange(dateStr, range.start, range.end);
        });
        return reindexResults(filtered);
    }

    // ===== 导出表格（xlsx，多Sheet）=====
    function buildWorkbookXlsx(topicResults, videoResults, cctvResults, wechatResults) {
        const wechatHeaders = ['序号', '标题', '链接', '发布时间', '阅读量', '点赞量', '在看量'];
        const videoHeaders = ['序号', '标题', '链接', '发布时间', '转发量', '点赞量', '评论量', '视频播放量'];
        const topicHeaders = ['序号', '话题名称', '话题主持人', '话题阅读量', '话题讨论量'];
        const hotHeaders = ['序号', '热搜标题', '最高排名', '话题主持人', '话题阅读量'];
        const cctvHeaders = ['序号', '标题', '链接', '发布时间', '播放量', '点赞量'];

        const wb = XLSX.utils.book_new();

        const wechatNumFields = ['序号', '阅读量', '点赞量', '在看量'];
        const wechatRows = (wechatResults || []).map((item) => (
            wechatHeaders.map((h) => {
                let val = item[h];
                const isNumField = wechatNumFields.includes(h);
                if (isNumField) {
                    val = (val === undefined || val === null || val === '') ? 0 : val;
                } else {
                    val = val || '';
                }
                return (typeof val === 'number' && Number.isFinite(val)) ? val : String(val);
            })
        ));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([wechatHeaders, ...wechatRows]), '微信');

        const cctvNumFields = ['序号', '播放量', '点赞量'];
        const cctvRows = (cctvResults || []).map((item) => (
            cctvHeaders.map((h) => {
                let val = item[h];
                const isNumField = cctvNumFields.includes(h);
                if (isNumField) {
                    val = (val === undefined || val === null || val === '') ? 0 : val;
                } else {
                    val = val || '';
                }
                return (typeof val === 'number' && Number.isFinite(val)) ? val : String(val);
            })
        ));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cctvHeaders, ...cctvRows]), '央视频');

        const videoRows = (videoResults || []).map((item) => (
            videoHeaders.map((h) => {
                const val = item[h] ?? '';
                return (typeof val === 'number' && Number.isFinite(val)) ? val : String(val);
            })
        ));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([videoHeaders, ...videoRows]), '微博');

        const topicRows = Array.isArray(topicResults) ? [...topicResults] : [];
        const getTopicRead = (row) => {
            const val = row && row['话题阅读量'];
            if (typeof val === 'number' && Number.isFinite(val)) return val;
            const num = Number(val);
            return Number.isFinite(num) ? num : 0;
        };
        topicRows.sort((a, b) => getTopicRead(b) - getTopicRead(a));
        const topicReadTotal = topicRows.reduce((sum, row) => sum + getTopicRead(row), 0);
        const topicDataRows = topicRows.map((row, idx) => (
            topicHeaders.map((h) => {
                let val = row[h] || '';
                if (h === '序号') val = idx + 1;
                return (typeof val === 'number' && Number.isFinite(val)) ? val : String(val);
            })
        ));
        const topicTotalRow = topicHeaders.map((h) => {
            if (h === '序号') return '总计';
            if (h === '话题阅读量') return topicReadTotal;
            return '';
        });
        XLSX.utils.book_append_sheet(
            wb,
            XLSX.utils.aoa_to_sheet([topicHeaders, ...topicDataRows, topicTotalRow]),
            '微博话题'
        );

        let hotIndex = 0;
        const hotRows = (topicResults || []).filter(row => row && row['热搜记录']).map((row) => {
            hotIndex += 1;
            const hotRow = {
                序号: hotIndex,
                热搜标题: row['话题名称'] || '',
                最高排名: row['热搜记录'] || '',
                话题主持人: row['话题主持人'] || '',
                话题阅读量: row['话题阅读量'] || ''
            };
            return hotHeaders.map((h) => {
                const val = hotRow[h] || '';
                return (typeof val === 'number' && Number.isFinite(val)) ? val : String(val);
            });
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([hotHeaders, ...hotRows]), '热搜');

        return wb;
    }

    function exportWorkbook() {
        const state = loadState();
        const range = getCollectRange(state);
        const filteredTopic = filterTopicResultsByRange(state.topic.results, range);
        const filteredVideo = filterVideoResultsByRange(state.video.results, range);
        const filteredCctv = filterCctvResultsByRange(state.cctv.results, range);
        const filteredWechat = filterWechatResultsByRange(state.wechat.results, range);
        const wb = buildWorkbookXlsx(filteredTopic, filteredVideo, filteredCctv, filteredWechat);
        const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const rangeStart = parseDateTimeLocalValue(state.collectRangeStart);
        const rangeEnd = parseDateTimeLocalValue(state.collectRangeEnd);
        const fmtPart = (d) => `${d.getMonth() + 1}月${d.getDate()}日${d.getHours()}时`;
        const fileName = rangeStart && rangeEnd
            ? `${fmtPart(rangeStart)}-${fmtPart(rangeEnd)}央视军事微信、微博、央视频发布数据汇总.xlsx`
            : `央视军事微信、微博、央视频发布数据汇总.xlsx`;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ===== 统一面板 =====
    let panelRefs = null;

    function createHubPanel() {
        if (document.getElementById('weibo-scraper-hub')) return;
        const container = document.createElement('div');
        container.id = 'weibo-scraper-hub';
        const shadow = container.attachShadow({ mode: 'open' });

        const wrap = document.createElement('div');
        wrap.style.cssText = [
            'position: fixed',
            'top: 15px',
            'right: 15px',
            `z-index: ${PANEL_Z_INDEX}`,
            'background: rgba(255,255,255,0.96)',
            'border: 1px solid #ddd',
            'border-radius: 12px',
            'padding: 10px',
            'width: 180px',
            'font-family: sans-serif',
            'box-shadow: 0 6px 20px rgba(0,0,0,0.2)'
        ].join(';');

        const title = document.createElement('div');
        title.textContent = '数据采集面板';
        title.style.cssText = 'font-weight:bold;margin-bottom:8px;font-size:13px;';

        const status = document.createElement('div');
        status.style.cssText = 'font-size:12px;line-height:1.6;margin-bottom:8px;';

        const rangeRow = document.createElement('div');
        const rangeLabel = document.createElement('span');
        const rangeSelect = document.createElement('select');

        const collectLabel = document.createElement('div');
        const rangeStartRow = document.createElement('div');
        const rangeStartLabel = document.createElement('span');
        const rangeStartInput = document.createElement('input');
        const rangeEndRow = document.createElement('div');
        const rangeEndLabel = document.createElement('span');
        const rangeEndInput = document.createElement('input');

        const btnVideo = document.createElement('button');
        const btnTopic = document.createElement('button');
        const btnCctv = document.createElement('button');
        const btnWechat = document.createElement('button');
        const btnClear = document.createElement('button');
        const btnExport = document.createElement('button');
        const footer = document.createElement('div');
        const footerText = document.createElement('span');
        const footerLink = document.createElement('a');
        const footerIcon = document.createElement('span');

        const btnStyle = [
            'width: 100%',
            'margin: 4px 0',
            'padding: 6px 8px',
            'border-radius: 8px',
            'border: none',
            'cursor: pointer',
            'font-size: 12px'
        ].join(';');

        rangeRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin:6px 0 6px 0;font-size:12px;';
        rangeLabel.textContent = '数据周期';
        rangeSelect.style.cssText = 'flex:1;min-width:0;padding:4px 6px;border:1px solid #ccc;border-radius:6px;font-size:12px;';
        const rangeOptions = [
            { value: 'all', label: '全部' },
            { value: '24h', label: '24小时' },
            { value: '30d', label: '30天' }
        ];
        rangeOptions.forEach((opt) => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            rangeSelect.appendChild(option);
        });

        collectLabel.textContent = '采集区间';
        collectLabel.style.cssText = 'margin:6px 0 4px 0;font-size:12px;font-weight:bold;';

        rangeStartRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin:4px 0;font-size:12px;';
        rangeStartLabel.textContent = '开始';
        rangeStartInput.type = 'datetime-local';
        rangeStartInput.style.cssText = 'flex:1;min-width:0;padding:4px 6px;border:1px solid #ccc;border-radius:6px;font-size:12px;';

        rangeEndRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin:4px 0 8px 0;font-size:12px;';
        rangeEndLabel.textContent = '结束';
        rangeEndInput.type = 'datetime-local';
        rangeEndInput.style.cssText = 'flex:1;min-width:0;padding:4px 6px;border:1px solid #ccc;border-radius:6px;font-size:12px;';


        btnVideo.style.cssText = `${btnStyle};background:#ff6b35;color:#fff;`;
        btnTopic.style.cssText = `${btnStyle};background:#9b59b6;color:#fff;`;
        btnCctv.style.cssText = `${btnStyle};background:#2d98da;color:#fff;`;
        btnWechat.style.cssText = `${btnStyle};background:#16a085;color:#fff;`;
        btnClear.style.cssText = `${btnStyle};background:#666;color:#fff;`;
        btnExport.style.cssText = `${btnStyle};background:#27ae60;color:#fff;`;
        footer.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-top:6px;font-size:12px;color:#666;';
        footerLink.style.cssText = 'display:inline-flex;align-items:center;gap:4px;color:#111;text-decoration:none;';
        footerIcon.style.cssText = 'width:16px;height:16px;display:inline-block;';

        rangeSelect.onchange = () => {
            const state = loadState();
            state.overviewRange = rangeSelect.value || DEFAULT_OVERVIEW_RANGE;
            saveState(state);
        };

        const saveCollectRange = () => {
            const startVal = rangeStartInput.value;
            const endVal = rangeEndInput.value;
            if (!startVal || !endVal) return;
            const start = parseDateTimeLocalValue(startVal);
            const end = parseDateTimeLocalValue(endVal);
            if (!start || !end || start > end) {
                showToast('采集区间不合法');
                return;
            }
            const state = loadState();
            state.collectRangeStart = startVal;
            state.collectRangeEnd = endVal;
            saveState(state);
        };

        rangeStartInput.onchange = saveCollectRange;
        rangeEndInput.onchange = saveCollectRange;


        btnVideo.onclick = onVideoToggleClick;
        btnTopic.onclick = onTopicToggleClick;
        btnCctv.onclick = onCctvToggleClick;
        btnWechat.onclick = onWechatImportClick;
        btnClear.onclick = () => {
            if (!confirm('确定清空全部数据？（数据周期、采集区间不会清空）')) return;
            const prev = loadState();
            const next = defaultState();
            next.overviewRange = prev.overviewRange || DEFAULT_OVERVIEW_RANGE;
            next.collectRangeStart = prev.collectRangeStart || next.collectRangeStart;
            next.collectRangeEnd = prev.collectRangeEnd || next.collectRangeEnd;
            saveState(next);
            showToast('已清空（保留数据周期、采集区间）');
        };
        btnExport.onclick = exportWorkbook;
        btnClear.textContent = '清除数据';
        btnWechat.textContent = '公众号数据';
        btnExport.textContent = '导出表格';
        footerText.textContent = '作者：Noah';
        footerLink.href = 'https://github.com/Noah-Wu66';
        footerLink.target = '_blank';
        footerLink.rel = 'noopener noreferrer';
        footerIcon.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" width="16" height="16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"></path></svg>';

        wrap.appendChild(title);
        wrap.appendChild(status);
        rangeRow.appendChild(rangeLabel);
        rangeRow.appendChild(rangeSelect);

        wrap.appendChild(rangeRow);
        wrap.appendChild(collectLabel);
        rangeStartRow.appendChild(rangeStartLabel);
        rangeStartRow.appendChild(rangeStartInput);
        rangeEndRow.appendChild(rangeEndLabel);
        rangeEndRow.appendChild(rangeEndInput);
        wrap.appendChild(rangeStartRow);
        wrap.appendChild(rangeEndRow);
        wrap.appendChild(btnVideo);
        wrap.appendChild(btnTopic);
        wrap.appendChild(btnCctv);
        wrap.appendChild(btnWechat);
        wrap.appendChild(btnClear);
        wrap.appendChild(btnExport);
        footerLink.appendChild(footerIcon);
        footer.appendChild(footerText);
        footer.appendChild(footerLink);
        wrap.appendChild(footer);
        shadow.appendChild(wrap);
        document.body.appendChild(container);

        panelRefs = { status, btnVideo, btnTopic, btnCctv, btnWechat, rangeSelect, rangeStartInput, rangeEndInput, shadow };
        refreshPanel();
        setInterval(refreshPanel, 1000);
    }

    function refreshPanel() {
        if (!panelRefs) return;
        const state = loadState();
        const topicCount = state.topic.results.length;
        const videoCount = state.video.results.length;
        const cctvCount = state.cctv.results.length;
        const wechatCount = state.wechat.results.length;
        const topicStatus = state.topic.running ? `采集中 ${state.topic.idx + 1}/${state.topic.topics.length}` : '空闲';
        const videoStatus = state.video.running ? '采集中' : '空闲';
        const cctvStatus = state.cctv.running ? `采集中 ${state.cctv.idx + 1}/${state.cctv.vids.length}` : '空闲';
        const topicLabel = '微博话题&热搜';
        const videoLabel = '微博数据';
        const cctvLabel = '央视频数据';
        const wechatLabel = '公众号数据';
        panelRefs.status.innerHTML = [
            `${topicLabel}：${topicStatus}`,
            `${topicLabel}数据：${topicCount} 条`,
            `${videoLabel}：${videoStatus}`,
            `${videoLabel}条数：${videoCount} 条`,
            `${cctvLabel}：${cctvStatus}`,
            `${cctvLabel}条数：${cctvCount} 条`,
            `${wechatLabel}：${wechatCount} 条`
        ].join('<br>');


        panelRefs.btnVideo.textContent = state.video.running ? '停止采集微博' : '微博数据';
        panelRefs.btnTopic.textContent = state.topic.running ? '停止采集话题' : '微博话题&热搜';
        panelRefs.btnCctv.textContent = state.cctv.running ? '停止采集央视频' : '央视频数据';
        if (panelRefs.shadow.activeElement !== panelRefs.rangeSelect) {
            panelRefs.rangeSelect.value = state.overviewRange || DEFAULT_OVERVIEW_RANGE;
        }
        if (panelRefs.shadow.activeElement !== panelRefs.rangeStartInput) {
            panelRefs.rangeStartInput.value = state.collectRangeStart || buildDefaultCollectRange().startValue;
        }
        if (panelRefs.shadow.activeElement !== panelRefs.rangeEndInput) {
            panelRefs.rangeEndInput.value = state.collectRangeEnd || buildDefaultCollectRange().endValue;
        }

        syncBusyOverlay();

    }



    function bumpPendingStartToken(state) {
        state._pendingStartToken = (state._pendingStartToken || 0) + 1;
    }


    function queueStartAndGotoTop(action) {
        const state = loadState();
        state._pendingStart = action; // 'topic' | 'video'
        bumpPendingStartToken(state);
        saveState(state);
        showBusyOverlay(getBusyTaskLabelByAction(action), '正在进入目标页面', '页面跳转完成后会自动开始采集。');
        if (isOnTargetUserPage()) {
            location.reload();
        } else {
            location.href = TARGET_USER_URL;
        }
    }

    function startTopicCollect() {
        startWeiboListCollection('topic');
    }

    function startVideoCollect() {
        startWeiboListCollection('video');
    }

    function onTopicToggleClick() {
        const state = loadState();
        if (state.topic.running) {
            stopWeiboListCollection('topic');
            return;
        }
        queueStartAndGotoTop('topic');
    }


    function onVideoToggleClick() {
        const state = loadState();
        if (state.video.running) {
            stopWeiboListCollection('video');
            return;
        }
        queueStartAndGotoTop('video');
    }

    function onCctvToggleClick() {
        const state = loadState();
        if (state.cctv.running) {
            state.cctv.running = false;
            saveState(state);
            showToast('已停止央视频采集');
            hideBusyOverlay();
            return;
        }
        state.cctv.running = true;
        state.cctv.step = 'collecting';
        state.cctv.idx = 0;
        state.cctv.vids = [];
        state.cctv.results = [];
        saveState(state);
        showBusyOverlay('央视频数据', '正在开始采集', '正在准备进入央视频页面。');
        if (!isOnCctvListPage()) {
            location.href = CCTV_LIST_URL;
            return;
        }
        runCctvListStep();
    }


    function onWechatImportClick() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv,text/csv';

        // 需要挂到 DOM 上，才能可靠触发 blur/cancel 检测
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        document.body.appendChild(input);

        input.onchange = () => {
            const file = input.files && input.files[0];
            if (!file) {
                input.remove();
                return;
            }
            importWechatFromFile(file);
            input.remove();
        };

        input.click();
    }


    createHubPanel();
    resumeTopicIfNeeded();
    (function autoStartAfterGoto() {
        const state = loadState();
        if (!state._pendingStart) return;
        if (!isOnTargetUserPage()) return;
        const action = state._pendingStart;
        const token = state._pendingStartToken || 0;
        state._pendingStart = null;
        saveState(state);
        setTimeout(() => {
            const latest = loadState();
            if ((latest._pendingStartToken || 0) !== token) return;
            if (action === 'topic') startTopicCollect();
            if (action === 'video') startVideoCollect();
        }, 600);
    })();
    if (isOnCctvListPage()) {
        runCctvListStep();
    }
    if (isOnCctvDetailPage() || isOnCctvMissingRoute()) {
        runCctvDetailStep();
    }
})();
