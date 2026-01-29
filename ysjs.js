// ==UserScript==
// @name         数据采集器
// @namespace    http://tampermonkey.net/
// @version      1.2.14
// @description  话题30天数据 + 用户微博数据，统一面板导出表格（单Sheet）
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
// @grant        GM_deleteValue
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = '__weibo_scraper_hub_v1';
    const SCROLL_WAIT_MS = 1500;
    const NO_NEW_RETRY_LIMIT = 6;
    const DEFAULT_COLLECT_RANGE_DAYS = 7;
    const DEFAULT_OVERVIEW_RANGE = '30d';
    const TARGET_UID = '6189120710';
    const TARGET_USER_URL = `https://m.weibo.cn/u/${TARGET_UID}`;
    const CCTV_CPID = '18141106690386005';
    const CCTV_LIST_URL = `https://w.yangshipin.cn/user?cpid=${CCTV_CPID}`;
    const CCTV_DETAIL_BASE = 'https://yangshipin.cn/video/home?vid=';
    const WEIBO_TEXT_CACHE = new Map();

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
            auto: {
                active: false,
                index: 0,
                current: '',
                requested: false,
                started: false,
                waitUntil: 0,
                wechatDone: false
            },
            _pendingStart: null,
            _pendingStartToken: 0,
            overviewRange: DEFAULT_OVERVIEW_RANGE,
            collectRangeStart: range.startValue,
            collectRangeEnd: range.endValue
        };
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
            cctv: { ...base.cctv, ...(data.cctv || {}) },
            auto: { ...base.auto, ...(data.auto || {}) }
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

    function clearState() {
        if (typeof GM_deleteValue === 'function') {
            GM_deleteValue(STORAGE_KEY);
        } else {
            localStorage.removeItem(STORAGE_KEY);
        }
    }

    function parseCount(text) {
        if (!text) return 0;
        const s = String(text).replace(/\s+/g, '').trim();
        if (s === '转发' || s === '评论' || s === '赞') return 0;
        const m = s.match(/([\d.]+)(万|亿)?/);
        if (!m) return 0;
        let num = parseFloat(m[1]);
        if (Number.isNaN(num)) return 0;
        if (m[2] === '万') num *= 10000;
        if (m[2] === '亿') num *= 100000000;
        return Math.round(num);
    }

    function escapeXml(str) {
        if (!str && str !== 0) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
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

    function isOnTargetUserPage() {
        return location.hostname === 'm.weibo.cn' && location.pathname === `/u/${TARGET_UID}`;
    }

    function isVerificationVisible() {
        const textHit = /验证码|安全验证|安全校验|拖动滑块|请完成验证|访问过于频繁|操作频繁|请求过于频繁|系统繁忙|请稍后再试|访问异常|风险提示|账号异常/.test(document.body ? document.body.textContent : '');
        const elHit = document.querySelector(
            '.geetest_holder,.geetest_panel,.yidun_panel,.yidun_popup,.captcha,[id*="captcha"],[class*="captcha"],iframe[src*="captcha"],iframe[src*="geetest"],iframe[src*="yidun"]'
        );
        return !!(textHit || elHit);
    }

    async function waitForAntiBotClear() {
        if (!isVerificationVisible()) return;
        showToast('检测到风控/验证，请手动处理，完成后自动继续');
        while (isVerificationVisible()) {
            await sleep(1000);
        }
        showToast('已通过验证，继续采集');
        await sleep(600);
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
        if (/^\d{1,2}:\d{2}$/.test(timeStr)) return '';
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

    function getOldestPublishDate(cards) {
        if (!cards || cards.length === 0) return null;
        let oldest = null;
        cards.forEach((card) => {
            const timeStr = getPublishTimeText(card);
            if (!timeStr) return;
            const date = parseTimeToDate(timeStr);
            if (!date) return;
            if (!oldest || date < oldest) oldest = date;
        });
        return oldest;
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

    function collectTopicsFromNode(node, set) {
        const anchors = Array.from(node.querySelectorAll('a'));
        for (const a of anchors) {
            const t = (a.textContent || '').trim();
            if (!t) continue;
            const matches = t.match(/#[^#\s]{1,80}#/g);
            if (!matches) continue;
            for (const raw of matches) {
                const name = normalizeTopicName(raw);
                if (!name) continue;
                set.add(name);
            }
        }
    }

    function findAllTopicsInPage(state) {
        const set = new Set();
        let reachedLimit = false;
        const range = getCollectRange(state);
        const cards = Array.from(document.querySelectorAll('.card'));
        for (const card of cards) {
            if (card.dataset.topicScanned) continue;
            const timeStr = getPublishTimeText(card);
            if (timeStr) {
                const timeDate = parseTimeToDate(timeStr);
                if (timeDate) {
                    if (timeDate < range.start) {
                        reachedLimit = true;
                        card.dataset.topicScanned = 'true';
                        continue;
                    }
                    if (timeDate > range.end) {
                        card.dataset.topicScanned = 'true';
                        continue;
                    }
                }
            } else {
                card.dataset.topicScanned = 'true';
                continue;
            }
            collectTopicsFromNode(card, set);
            card.dataset.topicScanned = 'true';
        }
        return { topics: Array.from(set), reachedLimit };
    }

    async function scrollAndCollectTopics(state) {
        state.topic.step = 'collecting';
        saveState(state);

        let lastCardCount = 0;
        let lastHeight = 0;
        let noGrow = 0;

        while (state.topic.running) {
            await waitForAntiBotClear();
            const scan = findAllTopicsInPage(state);
            for (const name of scan.topics) {
                if (state.topic.topics.includes(name)) continue;
                state.topic.topics.push(name);
            }
            saveState(state);

            if (scan.reachedLimit) break;

            const cardCount = document.querySelectorAll('.card').length;
            const height = document.body.scrollHeight;
            if (cardCount === lastCardCount && height === lastHeight) noGrow += 1;
            else noGrow = 0;
            lastCardCount = cardCount;
            lastHeight = height;

            if (noGrow >= NO_NEW_RETRY_LIMIT) break;

            const oldest = getOldestPublishDate(Array.from(document.querySelectorAll('.card')));
            if (oldest) {
                const checkpoint = state.topic._pauseCheckpoint;
                if (typeof checkpoint !== 'number') {
                    state.topic._pauseCheckpoint = oldest.getTime();
                    saveState(state);
                } else {
                    const diffDays = Math.floor((checkpoint - oldest.getTime()) / (24 * 60 * 60 * 1000));
                    if (diffDays >= 5) {
                        state.topic._pauseCheckpoint = oldest.getTime();
                        saveState(state);
                        showToast('已翻过5天，休息20-30秒后继续');
                        await sleepRange(20000, 30000);
                        state = loadState();
                        if (!state.topic.running) break;
                    }
                }
            }

            await humanScrollToBottom();
            await sleepHumanLike(SCROLL_WAIT_MS, 700);
            state = loadState();
        }

        return loadState();
    }

    function getTopicFromDetailPage() {
        const header = document.querySelector('.topic-header-wrap .topic .text');
        if (header && header.textContent) return normalizeTopicName(header.textContent);
        const q = new URLSearchParams(location.search).get('q') || '';
        return normalizeTopicName(decodeURIComponent(q));
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
        const before = JSON.stringify(getOverviewMetricsRaw());
        if (!isOverviewRangeActive(range)) {
            const tab = findOverviewRangeTab(range);
            if (tab) tab.click();
        }
        await waitFor(() => isOverviewRangeActive(range), 8000);
        await waitFor(() => JSON.stringify(getOverviewMetricsRaw()) !== before, 8000);
    }

    function pushResultFromDetailPage(state) {
        const topic = getTopicFromDetailPage();
        const host = getHostFromDetailPage();
        const metrics = getOverviewMetricsRaw();
        const hotSearchPeak = getHotSearchPeak();

        const readRaw = metrics['阅读量'] || '';
        const discussRaw = metrics['讨论量'] || '';

        const row = {
            序号: 0,
            话题名称: topic || '',
            话题主持人: host || '',
            话题阅读量: parseCount(readRaw),
            话题讨论量: parseCount(discussRaw),
            热搜记录: hotSearchPeak,
            抓取时间: nowStr()
        };

        if (row.话题主持人 !== '央视军事') return null;
        state.topic.results.push(row);
        state.topic.results.forEach((r, i) => r.序号 = i + 1);
        return row;
    }

    async function runTopicDetailStep() {
        let state = loadState();
        if (!state.topic.running || !isOnDetailPage()) return;

        try {
            await waitForAntiBotClear();
            state = loadState();
            if (!state.topic.running) return;
            await ensureOverviewRangeSelected(state.overviewRange || DEFAULT_OVERVIEW_RANGE);
            await sleepHumanLike(500, 300);

            state = loadState();
            if (!state.topic.running) return;
            const row = pushResultFromDetailPage(state);
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
                location.href = buildDetailUrl(state.topic.topics[state.topic.idx]);
            }
        } catch (e) {
            console.error('话题采集失败', e);
            showToast('话题抓取失败，已跳过');
            state = loadState();
            if (!state.topic.running) return;
            state.topic.idx++;
            saveState(state);
            if (state.topic.idx < state.topic.topics.length) {
                location.href = buildDetailUrl(state.topic.topics[state.topic.idx]);
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
        const s = await scrollAndCollectTopics(state);
        if (s.topic.running && s.topic.topics.length > 0) {
            location.href = buildDetailUrl(s.topic.topics[s.topic.idx] || s.topic.topics[0]);
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
            location.href = buildDetailUrl(state.topic.topics[state.topic.idx]);
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
        let text = '';
        try {
            const resp = await fetch(`https://m.weibo.cn/statuses/show?id=${weiboId}`, {
                credentials: 'same-origin'
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
        let reachedLimit = false;
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
                    reachedLimit = true;
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

            card.dataset.scraped = 'true';
            existingLinks.add(link);
        }

        return reachedLimit;
    }

    async function scrollAndCollectVideos() {
        let state = loadState();
        while (state.video.running) {
            await waitForAntiBotClear();
            const reachedLimit = await collectVideoData(state);
            saveState(state);

            if (reachedLimit) {
                showToast('已到时间范围，微博采集结束');
                break;
            }

            const currentCardCount = document.querySelectorAll('.card9').length;
            state.video._lastCardCount = state.video._lastCardCount || 0;
            state.video._noNewRetry = state.video._noNewRetry || 0;
            if (currentCardCount === state.video._lastCardCount) {
                state.video._noNewRetry++;
                if (state.video._noNewRetry > 5) {
                    showToast('没有更多内容，微博采集结束');
                    break;
                }
            } else {
                state.video._noNewRetry = 0;
                state.video._lastCardCount = currentCardCount;
            }
            saveState(state);

            const oldest = getOldestPublishDate(Array.from(document.querySelectorAll('.card9')));
            if (oldest) {
                const checkpoint = state.video._pauseCheckpoint;
                if (typeof checkpoint !== 'number') {
                    state.video._pauseCheckpoint = oldest.getTime();
                    saveState(state);
                } else {
                    const diffDays = Math.floor((checkpoint - oldest.getTime()) / (24 * 60 * 60 * 1000));
                    if (diffDays >= 5) {
                        state.video._pauseCheckpoint = oldest.getTime();
                        saveState(state);
                        showToast('已翻过5天，休息20-30秒后继续');
                        await sleepRange(20000, 30000);
                        state = loadState();
                        if (!state.video.running) break;
                    }
                }
            }

            await humanScrollToBottom();
            await sleepHumanLike(1500, 800);
            state = loadState();
        }

        state = loadState();
        const stoppedByUser = !state.video.running;
        state.video.running = false;
        delete state.video._lastCardCount;
        delete state.video._noNewRetry;
        delete state.video._pauseCheckpoint;
        saveState(state);
        if (!stoppedByUser) {
            showToast(`微博采集完成：${state.video.results.length}条`);
        }
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

    function collectCctvVidsFromDom() {
        const set = new Set();
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        for (const a of anchors) {
            const href = a.getAttribute('href') || '';
            if (!/portrait_video\?vid=|video\?type=0&vid=/.test(href)) continue;
            const vid = extractCctvVidFromLink(href);
            if (vid) set.add(vid);
        }
        const items = Array.from(document.querySelectorAll('.p-user-list-item[data-trace]'));
        for (const item of items) {
            const trace = item.getAttribute('data-trace') || '';
            const m = trace.match(/fval1:([a-zA-Z0-9]+)/);
            if (m && m[1]) set.add(m[1]);
        }
        const imgs = Array.from(document.querySelectorAll('img[data-src], img[src]'));
        for (const img of imgs) {
            const src = img.getAttribute('data-src') || img.getAttribute('src') || '';
            const m = src.match(/videoPic\/([a-zA-Z0-9]+)\//);
            if (m && m[1]) set.add(m[1]);
        }
        return Array.from(set);
    }

    function collectCctvVidsFromHtml() {
        const html = document.documentElement ? document.documentElement.innerHTML : '';
        const re = /portrait_video\?vid=([a-zA-Z0-9]+)/g;
        const set = new Set();
        let m;
        while ((m = re.exec(html)) !== null) {
            if (m[1]) set.add(m[1]);
        }
        const reTrace = /fval1:([a-zA-Z0-9]+)/g;
        while ((m = reTrace.exec(html)) !== null) {
            if (m[1]) set.add(m[1]);
        }
        const rePic = /videoPic\/([a-zA-Z0-9]+)\//g;
        while ((m = rePic.exec(html)) !== null) {
            if (m[1]) set.add(m[1]);
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
        const domVids = collectCctvVidsFromDom();
        domVids.forEach(vid => set.add(vid));
        const htmlVids = collectCctvVidsFromHtml();
        htmlVids.forEach(vid => set.add(vid));
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
            await waitFor(() => !!window.__STATE_user__, 8000);
            mergeCctvVids(state);
            saveState(state);

            if (state.cctv.vids.length === lastCount) noNew += 1;
            else noNew = 0;
            lastCount = state.cctv.vids.length;

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
        if (!state.cctv.running || !isOnCctvDetailPage()) return;

        await waitFor(() => {
            const t = document.querySelector('.video-main-l-title .title');
            const timeEl = document.querySelector('.video-main-l-time');
            return !!(t && t.textContent.trim() && timeEl);
        }, 8000);

        state = loadState();
        if (!state.cctv.running) return;

        const info = parseCctvDetailInfo();
        const range = getCollectRange(state);
        const dateOnly = info.date ? parseDateOnlyString(info.date) : null;
        if (dateOnly) {
            const startDay = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate());
            if (dateOnly < startDay) {
                state.cctv.running = false;
                saveState(state);
                showToast('已超出时间范围，央视频采集结束');
                location.href = CCTV_LIST_URL;
                return;
            }
        }

        const within = info.date
            ? isDateOnlyWithinRange(info.date, range.start, range.end)
            : true;

        if (within && info.title) {
            state.cctv.results.push({
                序号: state.cctv.results.length + 1,
                标题: info.title,
                链接: location.href,
                发布时间: info.date || '',
                播放量: info.playCount,
                点赞量: Number.isFinite(info.likeCount) ? info.likeCount : 0
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
                if (state.auto.active && state.auto.current === 'wechat') {
                    state.auto.wechatDone = true;
                    saveState(state);
                } else {
                    saveState(state);
                }
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
                const val = item[h] || '';
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
        const filteredVideo = filterVideoResultsByRange(state.video.results, range);
        const filteredCctv = filterCctvResultsByRange(state.cctv.results, range);
        const filteredWechat = filterWechatResultsByRange(state.wechat.results, range);
        const wb = buildWorkbookXlsx(state.topic.results, filteredVideo, filteredCctv, filteredWechat);
        const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `微博采集数据_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.xlsx`;
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
            'z-index: 2147483647',
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

        const btnAuto = document.createElement('button');
        const actionToggle = document.createElement('button');
        const actionGroup = document.createElement('div');
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

        btnAuto.style.cssText = `${btnStyle};background:#f39c12;color:#fff;`;
        actionToggle.style.cssText = `${btnStyle};background:#34495e;color:#fff;`;
        actionGroup.style.cssText = 'display:none;';
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

        btnAuto.onclick = onAutoCollectClick;
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
        btnAuto.textContent = '一键采集';
        actionToggle.textContent = '展开采集功能';
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
        actionToggle.onclick = () => {
            const isOpen = actionGroup.style.display !== 'none';
            actionGroup.style.display = isOpen ? 'none' : 'block';
            actionToggle.textContent = isOpen ? '展开采集功能' : '收起采集功能';
        };

        wrap.appendChild(btnAuto);
        wrap.appendChild(actionToggle);
        actionGroup.appendChild(btnVideo);
        actionGroup.appendChild(btnTopic);
        actionGroup.appendChild(btnCctv);
        actionGroup.appendChild(btnWechat);
        wrap.appendChild(actionGroup);
        wrap.appendChild(btnClear);
        wrap.appendChild(btnExport);
        footerLink.appendChild(footerIcon);
        footer.appendChild(footerText);
        footer.appendChild(footerLink);
        wrap.appendChild(footer);
        shadow.appendChild(wrap);
        document.body.appendChild(container);

        panelRefs = { status, btnAuto, btnVideo, btnTopic, btnCctv, btnWechat, rangeSelect, rangeStartInput, rangeEndInput, shadow };
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

        panelRefs.btnAuto.textContent = state.auto.active ? '一键采集中' : '一键采集';
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
        runAutoSequenceTick(state);
    }

    const AUTO_SEQUENCE = ['video', 'topic', 'cctv', 'wechat'];
    const AUTO_WAIT_MS = 5000;

    function isActionRunning(action, state) {
        if (action === 'video') return !!state.video.running;
        if (action === 'topic') return !!state.topic.running;
        if (action === 'cctv') {
            return !!state.cctv.running && state.cctv.step !== 'idle';
        }
        return false;
    }

    function startAutoAction(action) {
        if (action === 'video') {
            queueStartAndGotoTop('video');
            return;
        }
        if (action === 'topic') {
            queueStartAndGotoTop('topic');
            return;
        }
        if (action === 'cctv') {
            onCctvToggleClick();
            return;
        }
        if (action === 'wechat') {
            onWechatImportClick();
        }
    }

    function advanceAutoStep(state) {
        state.auto.index += 1;
        state.auto.current = '';
        state.auto.requested = false;
        state.auto.started = false;
        state.auto.wechatDone = false;
        state.auto.waitUntil = Date.now() + AUTO_WAIT_MS;
        saveState(state);
    }

    function runAutoSequenceTick(state) {
        if (!state.auto.active) return;
        if (state.auto.waitUntil && Date.now() < state.auto.waitUntil) return;

        if (!state.auto.current) {
            state.auto.current = AUTO_SEQUENCE[state.auto.index] || '';
            state.auto.requested = false;
            state.auto.started = false;
            state.auto.wechatDone = false;
            saveState(state);
        }

        if (!state.auto.current) {
            state.auto.active = false;
            state.auto.requested = false;
            state.auto.started = false;
            state.auto.waitUntil = 0;
            saveState(state);
            showToast('一键采集完成');
            return;
        }

        if (typeof state.auto.requested !== 'boolean') {
            state.auto.requested = false;
        }

        const action = state.auto.current;

        // 先“发起启动”，确保跳转/启动真正发生后，再进入下一步
        if (!state.auto.requested) {
            state.auto.requested = true;
            if (action === 'wechat') {
                state.auto.wechatDone = false;
                // 微信导入的“开始”就是弹出文件选择框
                state.auto.started = true;
            } else {
                // video/topic/cctv 必须等到 running 真的变成 true 才算开始
                state.auto.started = false;
            }
            saveState(state);
            startAutoAction(action);
            return;
        }

        // 已经发起过启动，但还没真正开始跑：一直等到 running 变 true
        if (!state.auto.started) {
            if (isActionRunning(action, state)) {
                state.auto.started = true;
                saveState(state);
            }
            return;
        }

        // 已经开始：等待彻底完成后才进入下一步
        if (action === 'wechat') {
            if (state.auto.wechatDone) {
                advanceAutoStep(state);
            }
            return;
        }

        if (!isActionRunning(action, state)) {
            advanceAutoStep(state);
        }
    }

    function bumpPendingStartToken(state) {
        state._pendingStartToken = (state._pendingStartToken || 0) + 1;
    }

    function stopAllCollecting() {
        const state = loadState();
        state.auto.active = false;
        state.auto.index = 0;
        state.auto.current = '';
        state.auto.requested = false;
        state.auto.started = false;
        state.auto.waitUntil = 0;
        state.auto.wechatDone = false;

        state.topic.running = false;
        state.topic.step = 'idle';
        delete state.topic._pauseCheckpoint;

        state.video.running = false;
        delete state.video._pauseCheckpoint;

        state.cctv.running = false;
        state.cctv.step = 'idle';

        state._pendingStart = null;
        bumpPendingStartToken(state);
        saveState(state);
    }

    function queueStartAndGotoTop(action) {
        const state = loadState();
        state._pendingStart = action; // 'topic' | 'video'
        bumpPendingStartToken(state);
        saveState(state);
        if (isOnTargetUserPage()) {
            location.reload();
        } else {
            location.href = TARGET_USER_URL;
        }
    }

    function startTopicCollect() {
        const state = loadState();
        state.topic.running = true;
        state.topic.idx = 0;
        state.topic.topics = [];
        state.topic.results = [];
        state.topic.step = 'collecting';
        delete state.topic._pauseCheckpoint;
        saveState(state);
        scrollAndCollectTopics(state).then(s => {
            if (s.topic.running && s.topic.topics.length > 0) {
                location.href = buildDetailUrl(s.topic.topics[0]);
            } else if (s.topic.topics.length === 0) {
                showToast('没找到话题');
                const latest = loadState();
                latest.topic.running = false;
                saveState(latest);
            }
        });
    }

    function startVideoCollect() {
        const state = loadState();
        state.video.running = true;
        state.video.results = [];
        delete state.video._pauseCheckpoint;
        saveState(state);
        scrollAndCollectVideos();
    }

    function onTopicToggleClick() {
        const state = loadState();
        if (state.topic.running) {
            state.topic.running = false;
            state.topic.step = 'idle';
            saveState(state);
            showToast('已停止话题采集');
            return;
        }
        queueStartAndGotoTop('topic');
    }

    function isOnUserPage() {
        return location.hostname === 'm.weibo.cn' && location.pathname.startsWith('/u/');
    }

    function onVideoToggleClick() {
        const state = loadState();
        if (state.video.running) {
            state.video.running = false;
            saveState(state);
            showToast('已停止微博采集');
            return;
        }
        queueStartAndGotoTop('video');
    }

    function onAutoCollectClick() {
        const state = loadState();
        if (state.auto.active) {
            stopAllCollecting();
            showToast('已停止一键采集');
            return;
        }
        state.auto.active = true;
        state.auto.index = 0;
        state.auto.current = '';
        state.auto.requested = false;
        state.auto.started = false;
        state.auto.waitUntil = 0;
        state.auto.wechatDone = false;
        saveState(state);
        showToast('一键采集已开始');
    }

    function onCctvToggleClick() {
        const state = loadState();
        if (state.cctv.running) {
            state.cctv.running = false;
            saveState(state);
            showToast('已停止央视频采集');
            return;
        }
        state.cctv.running = true;
        state.cctv.step = 'collecting';
        state.cctv.idx = 0;
        state.cctv.vids = [];
        state.cctv.results = [];
        saveState(state);
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
        let fileSelected = false;

        // 需要挂到 DOM 上，才能可靠触发 blur/cancel 检测
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        document.body.appendChild(input);
        
        input.onchange = () => {
            fileSelected = true;
            const file = input.files && input.files[0];
            if (!file) {
                // 用户取消了选择，标记为完成
                const state = loadState();
                if (state.auto.active && state.auto.current === 'wechat') {
                    state.auto.wechatDone = true;
                    saveState(state);
                }
                input.remove();
                return;
            }
            importWechatFromFile(file);
            input.remove();
        };
        
        // 检测用户取消文件选择（通过blur事件）
        input.addEventListener('blur', () => {
            setTimeout(() => {
                if (!fileSelected && document.body.contains(input)) {
                    const state = loadState();
                    if (state.auto.active && state.auto.current === 'wechat') {
                        state.auto.wechatDone = true;
                        saveState(state);
                    }
                    input.remove();
                }
            }, 500);
        });
        
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
    if (isOnCctvDetailPage()) {
        runCctvDetailStep();
    }
})();
