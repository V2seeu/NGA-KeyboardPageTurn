// ==UserScript==
// @name         NGA优化摸鱼体验插件-键盘翻页
// @namespace    https://github.com/kisshang1993/NGA-BBS-Script
// @version      1.1.0
// @author       kisshang1993-plugin
// @description  使用键盘左右方向键（←/→）在NGA论坛帖子/列表页之间翻页，与NGA-BBS-Script图片预览的方向键不冲突
// @license      MIT
// @match        *://bbs.nga.cn/*
// @match        *://ngabbs.com/*
// @match        *://nga.178.com/*
// @match        *://g.nga.cn/*
// @grant        unsafeWindow
// @run-at       document-start
// @inject-into  content
// ==/UserScript==

(function (registerPlugin) {
    'use strict';

    registerPlugin({
        name: 'KeyboardPageTurn',
        title: '键盘翻页',
        desc: '使用键盘 ← / → 方向键翻页，调用NGA原生翻页接口，与图片预览模式的方向键不冲突',

        settings: [
            {
                key: 'enablePrevKey',
                title: '启用 ← 上一页',
                default: true
            },
            {
                key: 'enableNextKey',
                title: '启用 → 下一页',
                default: true
            },
            {
                key: 'scrollToTop',
                title: '翻页后滚动到顶部',
                default: true
            },
            {
                key: 'showToast',
                title: '翻页时显示提示',
                default: true
            },
            {
                key: 'toastDuration',
                title: '提示持续时间(ms)',
                default: 800
            }
        ],

        initFunc() {
            const self = this;
            const SUPPRESS_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

            document.addEventListener('keydown', function (e) {
                if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;

                const key = e.key;
                if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;

                // Ignore when typing
                const active = document.activeElement;
                if (active) {
                    if (SUPPRESS_TAGS.has(active.tagName)) return;
                    if (active.isContentEditable) return;
                }

                // Yield to main script's image preview arrow-key handler
                if (self._isImagePreviewOpen()) return;

                const direction = key === 'ArrowLeft' ? 'prev' : 'next';

                if (direction === 'prev' && !self.pluginSettings['enablePrevKey']) return;
                if (direction === 'next' && !self.pluginSettings['enableNextKey']) return;

                e.preventDefault();
                self._navigate(direction);
            }, { capture: true });

            this.mainScript.printLog('[键盘翻页] 插件已初始化 ← 上一页 | → 下一页');
        },

        // ── Image preview detection ───────────────────────────────────────
        _isImagePreviewOpen() {
            const selectors = [
                '#ngaImagePreviewMask',
                '.nga-image-preview-mask',
                '.img_preview_mask',
                '#img_preview_mask',
            ];
            for (const sel of selectors) {
                try {
                    const el = document.querySelector(sel);
                    if (el && getComputedStyle(el).display !== 'none') return true;
                } catch(e) {}
            }
            return false;
        },

        // ── Core navigation ───────────────────────────────────────────────
        _navigate(direction) {
            // Strategy 1: NGA native commonui.turnPage() — the proper AJAX flip,
            // same as clicking the page number links. __PAGE is a global NGA injects:
            //   __PAGE[0] = path  (e.g. "/read.php")
            //   __PAGE[1] = current page (1-based)
            //   __PAGE[2] = total pages
            const win = unsafeWindow || window;
            const PAGE  = win.__PAGE;
            const cui   = win.commonui;

            if (PAGE && cui && typeof cui.turnPage === 'function') {
                const cur   = parseInt(PAGE[1], 10) || 1;
                const total = parseInt(PAGE[2], 10) || 1;
                const next  = direction === 'next' ? cur + 1 : cur - 1;

                if (next < 1) {
                    this._edgeToast('prev');
                    return;
                }
                if (next > total) {
                    this._edgeToast('next');
                    return;
                }

                if (this.pluginSettings['showToast']) {
                    this._toast(direction === 'next' ? `下一页 → (${next}/${total})` : `← 上一页 (${next}/${total})`);
                }
                if (this.pluginSettings['scrollToTop']) {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }

                // commonui.turnPage(page) triggers NGA's own AJAX page load
                setTimeout(() => cui.turnPage(next), 120);
                return;
            }

            // Strategy 2: Find the real DOM anchor NGA renders for prev/next.
            // NGA renders page links as <a class="b" ...> with text like "上一页" / "下一页",
            // also as <a class="uitxt1" title="加载下一页"> for AJAX loading,
            // and as plain numbered links. We scan all of them.
            const link = this._findNgaPagerLink(direction);
            if (link) {
                if (this.pluginSettings['showToast']) {
                    this._toast(direction === 'next' ? '下一页 →' : '← 上一页');
                }
                if (this.pluginSettings['scrollToTop']) {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
                setTimeout(() => link.click(), 120);
                return;
            }

            // Strategy 3: URL page param manipulation (true hard reload, last resort)
            const url = this._buildPageUrl(direction);
            if (url) {
                if (this.pluginSettings['showToast']) {
                    this._toast(direction === 'next' ? '下一页 →' : '← 上一页');
                }
                if (this.pluginSettings['scrollToTop']) {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
                setTimeout(() => { location.href = url; }, 120);
                return;
            }

            // Nothing matched — already at boundary
            this._edgeToast(direction);
        },

        // ── DOM link scan ─────────────────────────────────────────────────
        // NGA pagination anchors (observed in the real DOM):
        //   • Thread page:  <a class="b" href="...&page=N">上一页</a>
        //                   <a class="uitxt1" title="加载下一页" ...>
        //   • Forum list:   <a class="b" href="...&page=N">上一页</a> / 下一页
        _findNgaPagerLink(direction) {
            // Title-attribute based (AJAX load links that NGA-BBS-Script may use)
            if (direction === 'next') {
                const byTitle = document.querySelector(
                    'a[title="加载下一页"], a[title="下一页"], a.next_page'
                );
                if (byTitle) return byTitle;
            } else {
                const byTitle = document.querySelector(
                    'a[title="加载上一页"], a[title="上一页"], a.prev_page'
                );
                if (byTitle) return byTitle;
            }

            // Text-content scan across all anchors
            const PREV_RE = /^(上一页|上页|prev)$/i;
            const NEXT_RE = /^(下一页|下页|next)$/i;
            const pattern = direction === 'prev' ? PREV_RE : NEXT_RE;

            // Limit scan to likely pagination containers first, then fall back to all <a>
            const containers = [
                ...document.querySelectorAll('.pages, .pager, .page_turning, #pagebtm, #pagebottom, .pagebar, [id*="page"]')
            ];
            const anchors = containers.length
                ? containers.flatMap(c => [...c.querySelectorAll('a')])
                : [...document.querySelectorAll('a')];

            for (const a of anchors) {
                if (pattern.test(a.textContent.trim())) return a;
            }
            return null;
        },

        // ── URL fallback ──────────────────────────────────────────────────
        _buildPageUrl(direction) {
            const url = new URL(location.href);
            if (url.searchParams.has('page')) {
                const cur  = parseInt(url.searchParams.get('page'), 10) || 1;
                const next = direction === 'next' ? cur + 1 : cur - 1;
                if (next < 1) return null;
                url.searchParams.set('page', next);
                return url.toString();
            }
            return null;
        },

        // ── Toasts ────────────────────────────────────────────────────────
        _toast(msg) {
            const duration = Number(this.pluginSettings['toastDuration']) || 800;
            this.mainScript.popNotification(msg, duration);
        },

        _edgeToast(direction) {
            const msg = direction === 'next' ? '已是最后一页' : '已是第一页';
            this.mainScript.popNotification(msg, 1200);
            this.mainScript.printLog(`[键盘翻页] ${msg}`);
        },

        style: ''
    });

})(function (plugin) {
    plugin.meta = GM_info.script;
    unsafeWindow.ngaScriptPlugins = unsafeWindow.ngaScriptPlugins || [];
    unsafeWindow.ngaScriptPlugins.push(plugin);
});
