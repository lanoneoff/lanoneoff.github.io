(() => {
  'use strict';

  /* ---------- Constants ---------- */
  const DEFAULT_VOLUME = 0.6;
  const KEY_VOLUME = 'lev:volume';
  const KEY_MUTED = 'lev:muted';
  const UI_HIDE_MS = 2500;
  const SKIP_SEC = 5;
  const ICON = {
    play: '#i-play',
    pause: '#i-pause',
    fs: '#i-fs',
    off: '#i-vol-off',
    low: '#i-vol-low',
    med: '#i-vol-med',
    high: '#i-vol-high'
  };

  const mqFine = window.matchMedia('(hover: hover) and (pointer: fine)');
  const mqCoarse = window.matchMedia('(pointer: coarse)');
  const mqMobile = window.matchMedia('(max-width: 720px)');
  const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  const HAS_IO = 'IntersectionObserver' in window;

  /* ---------- Feature detection ---------- */
  const testVideo = document.createElement('video');
  testVideo.volume = 0.5;
  // iOS ignores video.volume; hide the slider there, keep mute.
  const SUPPORTS_VOLUME = Math.abs(testVideo.volume - 0.5) < 0.01;
  if (!SUPPORTS_VOLUME) document.documentElement.classList.add('no-volume');

  const CAN_FULLSCREEN =
    !!document.fullscreenEnabled || typeof testVideo.webkitEnterFullscreen === 'function';

  /* ---------- Helpers ---------- */
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  const fmt = (s) => {
    if (!Number.isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const sec = String(Math.floor(s % 60)).padStart(2, '0');
    return `${m}:${sec}`;
  };

  const store = {
    get(key) {
      try { return localStorage.getItem(key); } catch (e) { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch (e) { /* private mode */ }
    }
  };

  /* ---------- Shared state ---------- */
  const savedVolume = parseFloat(store.get(KEY_VOLUME));
  const prefs = {
    volume: Number.isFinite(savedVolume) ? clamp(savedVolume, 0, 1) : DEFAULT_VOLUME,
    muted: store.get(KEY_MUTED) === '1'
  };

  const cards = [];
  let activeCard = null; // card the user interacted with last

  function persist() {
    store.set(KEY_VOLUME, String(prefs.volume));
    store.set(KEY_MUTED, prefs.muted ? '1' : '0');
  }

  function anyWithSound() {
    return cards.some((c) => c.isPlaying && !c.previewing);
  }

  function pauseOthers(except) {
    cards.forEach((c) => {
      if (c !== except && c.isPlaying) c.pause({ reset: c.previewing });
    });
  }

  // Any explicit sound change ends a hover preview: the user now wants audio.
  function applyAll() {
    if (!prefs.muted) cards.forEach((c) => { c.previewing = false; });
    cards.forEach((c) => { c.applyAudio(); c.sync(); });
    persist();
  }

  function setVolume(value) {
    prefs.volume = clamp(value, 0, 1);
    prefs.muted = prefs.volume === 0;
    applyAll();
  }

  function toggleMute() {
    if (prefs.muted) {
      prefs.muted = false;
      if (prefs.volume === 0) prefs.volume = DEFAULT_VOLUME;
    } else {
      prefs.muted = true;
    }
    applyAll();
  }

  /* ---------- Work card ---------- */
  class WorkCard {
    constructor(el) {
      this.el = el;
      this.video = el.querySelector('video');
      this.title = el.querySelector('h3')?.textContent.trim() || 'Video';
      this.frame = el.querySelector('.frame');
      this.toggle = el.querySelector('.frame-toggle');
      this.center = el.querySelector('.center-icon');
      this.centerUse = this.center.querySelector('use');
      this.playBtn = el.querySelector('.play-btn');
      this.playUse = this.playBtn.querySelector('use');
      this.muteBtn = el.querySelector('.mute-btn');
      this.muteUse = this.muteBtn.querySelector('use');
      this.fsBtn = el.querySelector('.fs-btn');
      this.volSlider = el.querySelector('.vol-slider');
      this.seek = el.querySelector('.seek');
      this.timeEl = el.querySelector('.time');

      this.previewing = false;
      this.broken = false;
      this.scrubbing = false;
      this.uiTimer = null;

      // Enable custom UI (without JS the native controls stay).
      this.toggle.hidden = false;
      this.video.removeAttribute('controls');
      if (!CAN_FULLSCREEN) this.fsBtn.hidden = true;

      this.bind();
      this.applyAudio();
      this.updateTime();
      this.sync();
    }

    get isPlaying() {
      return !this.video.paused && !this.video.ended;
    }

    bind() {
      // Clicks
      this.toggle.addEventListener('click', () => this.handleToggle());
      this.playBtn.addEventListener('click', () => this.handleToggle());
      this.muteBtn.addEventListener('click', () => {
        activeCard = this;
        toggleMute();
      });
      this.volSlider.addEventListener('input', () => {
        activeCard = this;
        setVolume(parseFloat(this.volSlider.value));
      });
      this.seek.addEventListener('input', () => this.scrubTo());
      this.seek.addEventListener('change', () => { this.scrubbing = false; });
      this.fsBtn.addEventListener('click', () => this.toggleFullscreen());

      // Hover preview: desktop mouse only
      this.el.addEventListener('pointerenter', (e) => this.onEnter(e));
      this.el.addEventListener('pointerleave', (e) => this.onLeave(e));

      // Keyboard on focused card
      this.el.addEventListener('keydown', (e) => this.onKey(e));

      // Controls auto-hide
      ['pointermove', 'pointerdown', 'focusin', 'focusout'].forEach((type) => {
        this.el.addEventListener(type, () => this.showUi());
      });

      // Video state
      const v = this.video;
      v.addEventListener('play', () => { this.sync(); this.showUi(); });
      v.addEventListener('pause', () => this.sync());
      v.addEventListener('waiting', () => this.setLoading(true));
      v.addEventListener('playing', () => this.setLoading(false));
      v.addEventListener('canplay', () => this.setLoading(false));
      v.addEventListener('timeupdate', () => this.updateTime());
      v.addEventListener('loadedmetadata', () => this.updateTime());
      v.addEventListener('error', () => this.markBroken());
      v.querySelector('source:last-of-type')
        ?.addEventListener('error', () => this.markBroken());
    }

    /* --- Playback --- */

    async play({ preview = false } = {}) {
      if (this.broken) return;

      if (!preview) {
        pauseOthers(this);
        this.previewing = false;
        activeCard = this;
      }
      this.previewing = preview;
      this.applyAudio();
      if (this.video.readyState < 3) this.setLoading(true);

      try {
        await this.video.play();
      } catch (err) {
        if (err.name === 'NotAllowedError' && !this.video.muted) {
          // Autoplay policy blocked sound: fall back to muted playback.
          this.video.muted = true;
          try { await this.video.play(); } catch (e) { this.markBroken(); }
        } else if (err.name === 'NotSupportedError') {
          this.markBroken();
        } else if (err.name !== 'AbortError') {
          this.setLoading(false);
        }
      }
    }

    pause({ reset = false } = {}) {
      this.video.pause();
      if (reset) this.video.currentTime = 0;
      this.previewing = false;
      this.applyAudio();
      this.setLoading(false);
      this.sync();
    }

    handleToggle() {
      if (this.broken) return;
      activeCard = this;

      if (this.previewing) {
        // Click on a hover preview means "I want sound now".
        this.previewing = false;
        if (prefs.muted) toggleMute(); else applyAll();
        this.showUi();
        return;
      }

      if (this.isPlaying) {
        this.pause();
        this.flash(ICON.pause);
      } else {
        this.play();
        this.flash(ICON.play);
      }
    }

    onEnter(e) {
      if (e.pointerType !== 'mouse' || !mqFine.matches) return;
      if (this.broken || this.isPlaying || anyWithSound()) return;
      this.play({ preview: true });
    }

    onLeave(e) {
      if (e.pointerType !== 'mouse') return;
      if (this.previewing) this.pause({ reset: true });
    }

    applyAudio() {
      this.video.volume = prefs.volume;
      this.video.muted = this.previewing || prefs.muted;
    }

    load() {
      if (this.loaded) return;
      this.loaded = true;
      this.video.preload = 'metadata';
      this.video.load();
    }

    /* --- Seeking & keyboard --- */

    scrubTo() {
      this.scrubbing = true;
      const d = this.video.duration;
      if (!Number.isFinite(d) || d <= 0) return;
      this.video.currentTime = (this.seek.value / 1000) * d;
      this.updateTime();
    }

    seekBy(sec) {
      const d = this.video.duration;
      if (!Number.isFinite(d)) return;
      this.video.currentTime = clamp(this.video.currentTime + sec, 0, d);
      this.updateTime();
    }

    onKey(e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.target.matches('input[type="range"]')) return; // sliders keep native arrows
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.seekBy(-SKIP_SEC);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.seekBy(SKIP_SEC);
      }
    }

    toggleFullscreen() {
      if (document.fullscreenElement) {
        document.exitFullscreen?.();
      } else if (document.fullscreenEnabled && this.frame.requestFullscreen) {
        this.frame.requestFullscreen().catch(() => {});
      } else if (typeof this.video.webkitEnterFullscreen === 'function') {
        this.video.webkitEnterFullscreen();
      }
    }

    /* --- UI state --- */

    showUi() {
      this.el.classList.add('ui-show');
      clearTimeout(this.uiTimer);
      this.uiTimer = setTimeout(() => this.hideUi(), UI_HIDE_MS);
    }

    hideUi() {
      const ae = document.activeElement;
      const keyboardFocus = this.el.contains(ae) && ae.matches(':focus-visible');
      if (this.isPlaying && !this.scrubbing && !keyboardFocus) {
        this.el.classList.remove('ui-show');
      }
    }

    setLoading(on) {
      this.el.classList.toggle('is-loading', on);
    }

    flash(href) {
      this.center.classList.remove('is-flash');
      this.centerUse.setAttribute('href', href);
      void this.center.offsetWidth; // restart animation
      this.center.classList.add('is-flash');
    }

    updateTime() {
      const d = this.video.duration;
      const ready = Number.isFinite(d) && d > 0;

      this.timeEl.textContent = ready
        ? `${fmt(this.video.currentTime)} / ${fmt(d)}`
        : '';
      this.seek.disabled = !ready || this.broken;

      if (ready && !this.scrubbing) {
        const p = (this.video.currentTime / d) * 1000;
        this.seek.value = p;
        this.seek.style.setProperty('--fill', `${p / 10}%`);
      }
    }

    sync() {
      const playing = this.isPlaying;
      const muted = prefs.muted || prefs.volume === 0;
      const level = muted
        ? 'off'
        : prefs.volume < 0.34 ? 'low' : prefs.volume < 0.67 ? 'med' : 'high';

      this.el.classList.toggle('is-playing', playing);
      this.el.classList.toggle('is-previewing', this.previewing);

      this.playBtn.setAttribute('aria-label', playing ? `Pause ${this.title}` : `Play ${this.title}`);
      this.playUse.setAttribute('href', playing ? ICON.pause : ICON.play);

      this.muteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
      this.muteUse.setAttribute('href', ICON[level]);

      this.volSlider.value = prefs.volume;
      this.volSlider.style.setProperty('--fill', `${prefs.volume * 100}%`);

      if (!playing) {
        clearTimeout(this.uiTimer);
        this.el.classList.add('ui-show');
      }
    }

    markBroken() {
      if (this.broken) return;
      this.broken = true;
      this.previewing = false;
      this.video.pause();
      this.el.classList.add('is-broken');
      this.el.classList.remove('is-loading');
      [this.playBtn, this.muteBtn, this.fsBtn].forEach((b) => { b.disabled = true; });
      this.seek.disabled = true;
      this.volSlider.disabled = true;
    }
  }

  /* ---------- Init cards ---------- */
  document.querySelectorAll('.work-card').forEach((el) => cards.push(new WorkCard(el)));

  // Lazy metadata loading
  const lazyIO = HAS_IO
    ? new IntersectionObserver((entries, io) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          cards.find((c) => c.el === en.target)?.load();
          io.unobserve(en.target);
        });
      }, { rootMargin: '300px 0px' })
    : null;

  // Pause when the card leaves the screen
  const pauseIO = HAS_IO
    ? new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (en.intersectionRatio >= 0.3) return;
          const card = cards.find((c) => c.el === en.target);
          if (card?.isPlaying) card.pause({ reset: card.previewing });
        });
      }, { threshold: [0, 0.3] })
    : null;

  cards.forEach((c) => {
    if (lazyIO) lazyIO.observe(c.el); else c.load();
    if (pauseIO) pauseIO.observe(c.el);
  });

  // Pause everything when the tab is hidden
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    cards.forEach((c) => {
      if (c.isPlaying) c.pause({ reset: c.previewing });
    });
  });

  // Global shortcuts (not while typing in text fields)
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.('input[type="text"], input[type="email"], textarea, [contenteditable]')) return;

    const key = e.key.toLowerCase();
    if (key === 'm') {
      toggleMute();
    } else if (key === 'k') {
      const card = activeCard || cards.find((c) => c.isPlaying);
      card?.handleToggle();
    }
  });

  /* ---------- Section navigation ---------- */
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="#"]');
    if (!link) return;

    const id = link.getAttribute('href').slice(1);
    const target = id ? document.getElementById(id) : null;
    if (!target) return;

    e.preventDefault();
    const behavior = mqReduce.matches ? 'auto' : 'smooth';

    if (id === 'works' && mqMobile.matches && cards.length) {
      cards[0].el.scrollIntoView({ block: 'center', behavior });
    } else {
      target.scrollIntoView({ block: 'start', behavior });
    }

    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    history.replaceState(null, '', `#${id}`);
  });

  /* ---------- Email ---------- */
  const EMAIL = 'editorafterwork@gmail.com';
  const emailLink = document.getElementById('copyEmailBtn');
  const emailLabel = emailLink.querySelector('.btn-label');
  const statusEl = document.getElementById('copyStatus');
  let statusTimer = null;

  function copyFallback(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) { /* fall through */ }
    }
    return copyFallback(text);
  }

  emailLink.addEventListener('click', async (e) => {
    // On phones let mailto: open the mail app directly.
    if (mqCoarse.matches) return;

    e.preventDefault();
    const ok = await copyText(EMAIL);

    if (!ok) {
      window.location.href = `mailto:${EMAIL}`;
      return;
    }

    emailLink.classList.add('copied');
    emailLabel.textContent = 'Copied!';
    statusEl.textContent = 'Email address copied to clipboard';

    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      emailLink.classList.remove('copied');
      emailLabel.textContent = 'Email';
      statusEl.textContent = '';
    }, 2000);
  });
})();