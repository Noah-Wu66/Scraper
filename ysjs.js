// ==UserScript==
// @name         微博话题&视频采集器（合并版）
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  话题30天数据 + 用户视频数据，统一面板导出表格（单Sheet）
// @author       Your Name
// @match        https://m.weibo.cn/*
// @match        https://m.s.weibo.com/*
// @match        https://w.yangshipin.cn/*
// @match        https://yangshipin.cn/*
// @updateURL    https://raw.githubusercontent.com/Noah-Wu66/Scraper/main/ysjs.js
// @downloadURL  https://raw.githubusercontent.com/Noah-Wu66/Scraper/main/ysjs.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = '__weibo_scraper_hub_v1';
    const SCROLL_WAIT_MS = 1500;
    const NO_NEW_RETRY_LIMIT = 6;
    const DEFAULT_DAYS_LIMIT = 7;
    const TARGET_UID = '6189120710';
    const TARGET_USER_URL = `https://m.weibo.cn/u/${TARGET_UID}`;
    const CCTV_CPID = '18141106690386005';
    const CCTV_LIST_URL = `https://w.yangshipin.cn/user?cpid=${CCTV_CPID}`;
    const CCTV_DETAIL_BASE = 'https://yangshipin.cn/video/home?vid=';

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    function nowStr() { return new Date().toLocaleString('zh-CN'); }

    function safeJsonParse(str, fallback) {
        try { return JSON.parse(str); } catch { return fallback; }
    }

    function defaultState() {
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
            daysLimit: DEFAULT_DAYS_LIMIT
        };
    }

    function loadState() {
        const raw = typeof GM_getValue === 'function'
            ? GM_getValue(STORAGE_KEY, null)
            : localStorage.getItem(STORAGE_KEY);
        const data = safeJsonParse(raw, null);
        return normalizeState(data);
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
        const textHit = /验证码|安全验证|安全校验|拖动滑块|请完成验证/.test(document.body ? document.body.textContent : '');
        const elHit = document.querySelector(
            '.geetest_holder,.geetest_panel,.yidun_panel,.yidun_popup,.captcha,[id*="captcha"],[class*="captcha"],iframe[src*="captcha"],iframe[src*="geetest"],iframe[src*="yidun"]'
        );
        return !!(textHit || elHit);
    }

    async function waitForVerificationClear() {
        if (!isVerificationVisible()) return;
        showToast('检测到验证，请手动完成后自动继续');
        while (isVerificationVisible()) {
            await sleep(1000);
        }
        showToast('验证通过，继续采集');
        await sleep(500);
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
        const cards = Array.from(document.querySelectorAll('.card'));
        for (const card of cards) {
            if (card.dataset.topicScanned) continue;
            const timeEl = card.querySelector('.time');
            const timeStr = timeEl ? timeEl.textContent.trim() : '';
            if (timeStr && !isWithinDays(timeStr, state.daysLimit || DEFAULT_DAYS_LIMIT)) {
                reachedLimit = true;
                card.dataset.topicScanned = 'true';
                continue;
            }
            if (!timeStr) {
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
            await waitForVerificationClear();
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

            window.scrollTo(0, document.body.scrollHeight);
            await sleep(SCROLL_WAIT_MS);
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

    function findOverview30DaysTab() {
        const panel = Array.from(document.querySelectorAll('.ui-pannel')).find(p => (p.textContent || '').includes('数据总览'));
        if (!panel) return null;
        const tabs = Array.from(panel.querySelectorAll('.tab .tab_text'));
        return tabs.find(t => (t.textContent || '').trim() === '30天') || null;
    }

    function is30DaysActive() {
        const tab = findOverview30DaysTab();
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

    async function ensureOverview30DaysSelected() {
        await waitFor(() => !!findOverview30DaysTab(), 8000);
        const before = JSON.stringify(getOverviewMetricsRaw());
        if (!is30DaysActive()) {
            const tab = findOverview30DaysTab();
            if (tab) tab.click();
        }
        await waitFor(() => is30DaysActive(), 8000);
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
            await waitForVerificationClear();
            await ensureOverview30DaysSelected();
            await sleep(500);

            state = loadState();
            const row = pushResultFromDetailPage(state);
            if (row && row.话题名称) {
                saveState(state);
            }

            state = loadState();
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

    // ===== 视频采集逻辑 =====
    function pad(n) { return n < 10 ? '0' + n : n; }

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

    function isWithinDays(timeStr, days) {
        const now = new Date();
        if (timeStr.includes('分钟前') || timeStr.includes('刚刚')) return true;
        if (timeStr.includes('小时前')) return true;
        if (timeStr.includes('昨天')) return days >= 1;
        if (timeStr.includes('天前')) {
            const daysAgo = parseInt(timeStr);
            return daysAgo <= days;
        }
        const fullDateMatch = timeStr.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (fullDateMatch) {
            const postDate = new Date(parseInt(fullDateMatch[1]), parseInt(fullDateMatch[2]) - 1, parseInt(fullDateMatch[3]));
            const diffDays = (now - postDate) / (1000 * 60 * 60 * 24);
            return diffDays <= days;
        }
        const dateMatch = timeStr.match(/(\d{1,2})-(\d{1,2})/);
        if (dateMatch) {
            const month = parseInt(dateMatch[1]) - 1;
            const day = parseInt(dateMatch[2]);
            const year = now.getMonth() < month ? now.getFullYear() - 1 : now.getFullYear();
            const postDate = new Date(year, month, day);
            const diffDays = (now - postDate) / (1000 * 60 * 60 * 24);
            return diffDays <= days;
        }
        return true;
    }

    function extractTitle(textEl) {
        if (!textEl) return '';
        const text = textEl.textContent.trim();
        const topicMatch = text.match(/#([^#]+)#/);
        if (topicMatch) return topicMatch[1];
        const bracketMatch = text.match(/【([^】]+)】/);
        if (bracketMatch) return bracketMatch[1];
        return text.substring(0, 30).replace(/\s+/g, ' ');
    }

    function buildWeiboLink(card) {
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

    function collectVideoData(state) {
        const cards = document.querySelectorAll('.card9');
        let reachedLimit = false;
        const existingLinks = new Set(state.video.results.map(r => r.链接));

        cards.forEach((card) => {
            if (card.dataset.scraped) return;

            const timeEl = card.querySelector('.time');
            const timeStr = timeEl ? timeEl.textContent.trim() : '';
            if (!isWithinDays(timeStr, state.daysLimit || DEFAULT_DAYS_LIMIT)) {
                reachedLimit = true;
                return;
            }

            const videoEl = card.querySelector('.card-video');
            if (!videoEl) return;

            const link = buildWeiboLink(card);
            if (!link || existingLinks.has(link)) {
                card.dataset.scraped = 'true';
                return;
            }

            const playCountEl = videoEl.querySelector('.m-box-col');
            const playCountStr = playCountEl ? playCountEl.textContent.trim() : '0';
            const playCount = parseCount(playCountStr.replace('次播放', ''));

            const footer = card.querySelector('footer');
            const btns = footer ? footer.querySelectorAll('.m-diy-btn h4') : [];
            const forward = btns[0] ? parseCount(btns[0].textContent) : 0;
            const comment = btns[1] ? parseCount(btns[1].textContent) : 0;
            const like = btns[2] ? parseCount(btns[2].textContent) : 0;

            const textEl = card.querySelector('.weibo-text');
            const title = extractTitle(textEl);
            const formattedTime = parseTimeToAbsolute(timeStr);

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
        });

        return reachedLimit;
    }

    async function scrollAndCollectVideos() {
        let state = loadState();
        while (state.video.running) {
            const reachedLimit = collectVideoData(state);
            saveState(state);

            if (reachedLimit) {
                showToast('已到时间范围，视频采集结束');
                break;
            }

            const currentCardCount = document.querySelectorAll('.card9').length;
            state.video._lastCardCount = state.video._lastCardCount || 0;
            state.video._noNewRetry = state.video._noNewRetry || 0;
            if (currentCardCount === state.video._lastCardCount) {
                state.video._noNewRetry++;
                if (state.video._noNewRetry > 5) {
                    showToast('没有更多内容，视频采集结束');
                    break;
                }
            } else {
                state.video._noNewRetry = 0;
                state.video._lastCardCount = currentCardCount;
            }
            saveState(state);

            window.scrollTo(0, document.body.scrollHeight);
            await sleep(1500);
            state = loadState();
        }

        state = loadState();
        state.video.running = false;
        delete state.video._lastCardCount;
        delete state.video._noNewRetry;
        saveState(state);
        showToast(`视频采集完成：${state.video.results.length}条`);
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
        return Array.from(set);
    }

    function collectCctvVidsFromState() {
        const data = window.__STATE_user__ || readCctvStateFromScripts();
        const list = data?.payloads?.userShareData?.video_list
            || data?.payloads?.userShareData?.cnt_info?.video_list
            || [];
        const vids = [];
        for (const item of list) {
            const vid = item?.vid || extractCctvVidFromLink(item?.h5Link);
            if (vid) vids.push(vid);
        }
        if (vids.length > 0) return vids;
        const domVids = collectCctvVidsFromDom();
        if (domVids.length > 0) return domVids;
        return collectCctvVidsFromHtml();
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

            if (state.cctv.vids.length > 0 && state.cctv.idx < state.cctv.vids.length) {
                break;
            }

            if (state.cctv.vids.length === lastCount) noNew += 1;
            else noNew = 0;
            lastCount = state.cctv.vids.length;

            rounds += 1;
            if (noNew >= NO_NEW_RETRY_LIMIT || rounds >= 8) break;

            window.scrollTo(0, document.body.scrollHeight);
            await sleep(1500);
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

        const info = parseCctvDetailInfo();
        const within = info.date
            ? isWithinDays(info.date, state.daysLimit || DEFAULT_DAYS_LIMIT)
            : true;

        if (!within) {
            state.cctv.running = false;
            saveState(state);
            showToast('已超出时间范围，央视频采集结束');
            location.href = CCTV_LIST_URL;
            return;
        }

        if (info.title) {
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

    // ===== 导出表格（仅改名，不改结构：多Sheet）=====
    function buildWorkbookXml(topicResults, videoResults, cctvResults, wechatResults) {
        const wechatHeaders = ['序号', '标题', '链接', '发布时间', '阅读量', '点赞量', '在看量'];
        const videoHeaders = ['序号', '标题', '链接', '发布时间', '转发量', '点赞量', '评论量', '视频播放量'];
        const topicHeaders = ['序号', '话题名称', '话题主持人', '话题阅读量', '话题讨论量'];
        const hotHeaders = ['序号', '热搜标题', '最高排名', '话题主持人', '话题阅读量'];
        const cctvHeaders = ['序号', '标题', '链接', '发布时间', '播放量', '点赞量'];

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<?mso-application progid="Excel.Sheet"?>\n';
        xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n';
        xml += '  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n';

        // Sheet 1: 微信
        xml += '<Worksheet ss:Name="微信"><Table>\n';
        xml += '<Row>';
        wechatHeaders.forEach(h => { xml += `<Cell><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`; });
        xml += '</Row>\n';
        const wechatNumFields = ['序号', '阅读量', '点赞量', '在看量'];
        (wechatResults || []).forEach(item => {
            xml += '<Row>';
            wechatHeaders.forEach(h => {
                let val = item[h];
                const isNumField = wechatNumFields.includes(h);
                if (isNumField) {
                    val = (val === undefined || val === null || val === '') ? 0 : val;
                } else {
                    val = val || '';
                }
                const isNum = typeof val === 'number' && Number.isFinite(val);
                const type = isNum ? 'Number' : 'String';
                xml += `<Cell><Data ss:Type="${type}">${escapeXml(val)}</Data></Cell>`;
            });
            xml += '</Row>\n';
        });
        xml += '</Table></Worksheet>\n';

        // Sheet 2: 央视频
        xml += '<Worksheet ss:Name="央视频"><Table>\n';
        xml += '<Row>';
        cctvHeaders.forEach(h => { xml += `<Cell><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`; });
        xml += '</Row>\n';
        const cctvNumFields = ['序号', '播放量', '点赞量'];
        (cctvResults || []).forEach(item => {
            xml += '<Row>';
            cctvHeaders.forEach(h => {
                let val = item[h];
                const isNumField = cctvNumFields.includes(h);
                if (isNumField) {
                    val = (val === undefined || val === null || val === '') ? 0 : val;
                } else {
                    val = val || '';
                }
                const isNum = typeof val === 'number' && Number.isFinite(val);
                const type = isNum ? 'Number' : 'String';
                xml += `<Cell><Data ss:Type="${type}">${escapeXml(val)}</Data></Cell>`;
            });
            xml += '</Row>\n';
        });
        xml += '</Table></Worksheet>\n';

        // Sheet 3: 微博
        xml += '<Worksheet ss:Name="微博"><Table>\n';
        xml += '<Row>';
        videoHeaders.forEach(h => { xml += `<Cell><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`; });
        xml += '</Row>\n';
        (videoResults || []).forEach(item => {
            xml += '<Row>';
            videoHeaders.forEach(h => {
                const val = item[h] || '';
                const isNum = typeof val === 'number' && Number.isFinite(val);
                const type = isNum ? 'Number' : 'String';
                xml += `<Cell><Data ss:Type="${type}">${escapeXml(val)}</Data></Cell>`;
            });
            xml += '</Row>\n';
        });
        xml += '</Table></Worksheet>\n';

        // Sheet 4: 微博话题
        xml += '<Worksheet ss:Name="微博话题"><Table>\n';
        xml += '<Row>';
        topicHeaders.forEach(h => { xml += `<Cell><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`; });
        xml += '</Row>\n';
        (topicResults || []).forEach(row => {
            xml += '<Row>';
            topicHeaders.forEach(h => {
                const val = row[h] || '';
                const isNum = typeof val === 'number' && Number.isFinite(val);
                const type = isNum ? 'Number' : 'String';
                xml += `<Cell><Data ss:Type="${type}">${escapeXml(val)}</Data></Cell>`;
            });
            xml += '</Row>\n';
        });
        xml += '</Table></Worksheet>\n';

        // Sheet 5: 热搜
        xml += '<Worksheet ss:Name="热搜"><Table>\n';
        xml += '<Row>';
        hotHeaders.forEach(h => { xml += `<Cell><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`; });
        xml += '</Row>\n';
        let hotIndex = 0;
        (topicResults || []).forEach((row) => {
            if (!row['热搜记录']) return;
            hotIndex += 1;
            const hotRow = {
                序号: hotIndex,
                热搜标题: row['话题名称'] || '',
                最高排名: row['热搜记录'] || '',
                话题主持人: row['话题主持人'] || '',
                话题阅读量: row['话题阅读量'] || ''
            };
            xml += '<Row>';
            hotHeaders.forEach(h => {
                const val = hotRow[h] || '';
                const isNum = typeof val === 'number' && Number.isFinite(val);
                const type = isNum ? 'Number' : 'String';
                xml += `<Cell><Data ss:Type="${type}">${escapeXml(val)}</Data></Cell>`;
            });
            xml += '</Row>\n';
        });
        xml += '</Table></Worksheet>\n';

        xml += '</Workbook>';
        return xml;
    }

    function exportWorkbook() {
        const state = loadState();
        const xml = buildWorkbookXml(state.topic.results, state.video.results, state.cctv.results, state.wechat.results);
        const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `微博采集数据_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.xls`;
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
        title.textContent = '微博采集面板';
        title.style.cssText = 'font-weight:bold;margin-bottom:8px;font-size:13px;';

        const status = document.createElement('div');
        status.style.cssText = 'font-size:12px;line-height:1.6;margin-bottom:8px;';

        const daysRow = document.createElement('div');
        const daysLabel = document.createElement('span');
        const daysInput = document.createElement('input');

        const btnTopic = document.createElement('button');
        const btnVideo = document.createElement('button');
        const btnCctv = document.createElement('button');
        const btnWechat = document.createElement('button');
        const btnExport = document.createElement('button');
        const btnClear = document.createElement('button');

        const btnStyle = [
            'width: 100%',
            'margin: 4px 0',
            'padding: 6px 8px',
            'border-radius: 8px',
            'border: none',
            'cursor: pointer',
            'font-size: 12px'
        ].join(';');

        daysRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin:6px 0 8px 0;font-size:12px;';
        daysLabel.textContent = '采集周期(天)';
        daysInput.type = 'number';
        daysInput.min = '1';
        daysInput.max = '365';
        daysInput.placeholder = String(DEFAULT_DAYS_LIMIT);
        daysInput.style.cssText = 'flex:1;min-width:0;padding:4px 6px;border:1px solid #ccc;border-radius:6px;font-size:12px;';

        btnTopic.style.cssText = `${btnStyle};background:#9b59b6;color:#fff;`;
        btnVideo.style.cssText = `${btnStyle};background:#ff6b35;color:#fff;`;
        btnCctv.style.cssText = `${btnStyle};background:#2d98da;color:#fff;`;
        btnWechat.style.cssText = `${btnStyle};background:#16a085;color:#fff;`;
        btnExport.style.cssText = `${btnStyle};background:#27ae60;color:#fff;`;
        btnClear.style.cssText = `${btnStyle};background:#666;color:#fff;`;

        daysInput.oninput = () => {
            const val = parseInt(daysInput.value, 10);
            if (!Number.isFinite(val) || val < 1) return;
            const state = loadState();
            state.daysLimit = val;
            saveState(state);
        };

        btnTopic.onclick = onTopicToggleClick;
        btnVideo.onclick = onVideoToggleClick;
        btnCctv.onclick = onCctvToggleClick;
        btnWechat.onclick = onWechatImportClick;
        btnExport.onclick = exportWorkbook;
        btnClear.onclick = () => {
            if (!confirm('确定清空全部数据？（采集周期不会清空）')) return;
            const prev = loadState();
            const keepDays = prev.daysLimit || DEFAULT_DAYS_LIMIT;
            const next = defaultState();
            next.daysLimit = keepDays;
            saveState(next);
            showToast('已清空（保留采集周期）');
        };
        btnExport.textContent = '导出表格';
        btnClear.textContent = '清空数据';
        btnWechat.textContent = '导入微信CSV';

        wrap.appendChild(title);
        wrap.appendChild(status);
        daysRow.appendChild(daysLabel);
        daysRow.appendChild(daysInput);

        wrap.appendChild(daysRow);
        wrap.appendChild(btnTopic);
        wrap.appendChild(btnVideo);
        wrap.appendChild(btnCctv);
        wrap.appendChild(btnWechat);
        wrap.appendChild(btnExport);
        wrap.appendChild(btnClear);
        shadow.appendChild(wrap);
        document.body.appendChild(container);

        panelRefs = { status, btnTopic, btnVideo, btnCctv, btnWechat, daysInput, shadow };
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
        panelRefs.status.innerHTML = [
            `话题：${topicStatus}`,
            `话题数据：${topicCount} 条`,
            `视频：${videoStatus}`,
            `视频数据：${videoCount} 条`,
            `央视频：${cctvStatus}`,
            `央视频数据：${cctvCount} 条`,
            `微信数据：${wechatCount} 条`
        ].join('<br>');

        panelRefs.btnTopic.textContent = state.topic.running ? '停止采集话题' : '开始采集话题';
        panelRefs.btnVideo.textContent = state.video.running ? '停止采集视频' : '开始采集视频';
        panelRefs.btnCctv.textContent = state.cctv.running ? '停止采集央视频' : '开始采集央视频';
        if (panelRefs.shadow.activeElement !== panelRefs.daysInput) {
            panelRefs.daysInput.value = String(state.daysLimit || DEFAULT_DAYS_LIMIT);
        }
    }

    function queueStartAndGotoTop(action) {
        const state = loadState();
        state._pendingStart = action; // 'topic' | 'video'
        state.daysLimit = state.daysLimit || DEFAULT_DAYS_LIMIT;
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
        state.daysLimit = state.daysLimit || DEFAULT_DAYS_LIMIT;
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
        state.daysLimit = state.daysLimit || DEFAULT_DAYS_LIMIT;
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
            showToast('已停止视频采集');
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
            return;
        }
        state.cctv.running = true;
        state.cctv.step = 'collecting';
        state.cctv.idx = 0;
        state.cctv.vids = [];
        state.cctv.results = [];
        state.daysLimit = state.daysLimit || DEFAULT_DAYS_LIMIT;
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
        input.onchange = () => {
            const file = input.files && input.files[0];
            if (!file) return;
            importWechatFromFile(file);
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
        state._pendingStart = null;
        saveState(state);
        setTimeout(() => {
            if (action === 'topic') startTopicCollect();
            if (action === 'video') startVideoCollect();
        }, 600);
    })();
    if (loadState().topic.running && isOnDetailPage()) {
        runTopicDetailStep();
    }
    if (isOnCctvListPage()) {
        runCctvListStep();
    }
    if (isOnCctvDetailPage()) {
        runCctvDetailStep();
    }
})();
