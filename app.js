(() => {
  'use strict';

  // ---------- Config ----------
  const DEFAULT_VOLUME = 0.6;
  const KEY_VOLUME = 'lev:volume';
  const KEY_MUTED = 'lev:muted';
  const SKIP_SEC = 5;
  const PAUSE_RATIO = 0.3;
  const EMAIL = 'editorafterwork@gmail.com';

  const root = document.documentElement;

  const mqCoarse = window.matchMedia('(pointer: coarse)');
  const mqFine = window.matchMedia('(hover: hover) and (pointer: fine)');
  const mqMobile = window.matchMedia('(max-width: 720px)');
  const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  let cards = [];

  // ---------- Volume support probe ----------
  // iOS ignores video.volume. If so, the slider is hidden and only mute remains.
  (function probeVolume() {
    const probe = document.createElement('video');
    probe.volume = 0.5;
    if (Math.abs(probe.volume - 0.5) > 0.01) root.classList.add('no-volume');
  })();

  // ---------- Shared preferences ----------
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  function loadPrefs() {
    let volume = DEFAULT_VOLUME;
    let muted = false; // sound is on by default
    try {
      const v = parseFloat(localStorage.getItem(KEY_VOLUME));
      if (Number.isFinite(v)) volume = clamp(v, 0, 1);
      muted = localStorage.getItem(KEY_MUTED) === '1';
    } catch (_) { /* storage unavailable: use defaults */ }
    return { volume, muted };
  }

  const prefs = loadPrefs();

  const isSilentByUser = () => prefs.muted || prefs.volume === 0;

  function persistPrefs() {
    try {
      localStorage.setItem(KEY_VOLUME, String(prefs.volume));
      localStorage.setItem(KEY_MUTED, prefs.muted ? '1' : '0');
    } catch (_) { /* ignore */ }
  }

  function setVolume(v) {
    prefs.volume = clamp(v, 0, 1);
    prefs.muted = prefs.volume === 0;
  }

  function toggleMute() {
    if (isSilentByUser()) {
      prefs.muted = false;
      if (prefs.volume === 0) prefs.volume = DEFAULT_VOLUME;
    } else {
      prefs.muted = true;
    }
    applyAll();
  }

  // Applies preferences to every card and saves them.
  function applyAll() {
    const audible = !isSilentByUser();
    cards.forEach(card => {
      // Sound is allowed now: a browser-blocked video switches to sound.
      if (audible) card.autoMuted = false;
      card.applyAudio();
      card.sync();
    });
    persistPrefs();
  }

  // ---------- Work card ----------
  class WorkCard {
    constructor(card) {
      this.card = card;
      this.video = card.querySelector('video.work-video');
      this.frameToggle = card.querySelector('.frame-toggle');
      this.muteBtn = card.querySelector('.mute-btn');
      this.slider = card.querySelector('.vol-slider');
      this.pill = card.querySelector('.sound-pill');
      this.overlay = card.querySelector('.video-overlay');
      const h3 = card.querySelector('h3');
      this.title = h3 ? h3.textContent.trim() : 'Work';

      this.loaded = false;
      this.broken = false;
      // Browser blocked sound: playing muted until the next click.
      this.autoMuted = false;

      // JS replaces native controls with the custom overlay.
      this.video.removeAttribute('controls');

      this.bind();
      this.applyAudio();
      this.sync();
    }

    bind() {
      const v = this.video;

      v.addEventListener('play', () => this.sync());

      v.addEventListener('pause', () => {
        this.autoMuted = false;
        this.applyAudio();
        this.sync();
      });

      v.addEventListener('waiting', () => this.card.classList.add('is-loading'));
      v.addEventListener('stalled', () => this.card.classList.add('is-loading'));
      v.addEventListener('playing', () => this.card.classList.remove('is-loading'));
      v.addEventListener('canplay', () => this.card.classList.remove('is-loading'));

      // Errors on <source> do not bubble. Only the last source failing means
      // no playable file exists.
      const sources = v.querySelectorAll('source');
      const last = sources[sources.length - 1];
      if (last) last.addEventListener('error', () => this.markBroken());
      else v.addEventListener('error', () => this.markBroken());

      this.frameToggle.addEventListener('click', () => this.handleToggle());

      this.muteBtn.addEventListener('click', () => toggleMute());

      if (this.overlay) {
        this.overlay.addEventListener('click', e => e.stopPropagation());
      }

      if (this.slider) {
        this.slider.addEventListener('input', () => {
          setVolume(parseFloat(this.slider.value));
          applyAll();
        });
      }

      this.card.addEventListener('keydown', e => this.onKeydown(e));
    }

    load() {
      if (this.loaded || this.broken) return;
      this.loaded = true;
      this.video.load();
    }

    applyAudio() {
      this.video.volume = prefs.volume;
      this.video.muted = this.autoMuted || isSilentByUser();
    }

    sync() {
      const playing = !this.video.paused;
      const silent = isSilentByUser();

      this.card.classList.toggle('is-playing', playing);
      this.card.classList.toggle('is-broken', this.broken);

      if (this.frameToggle) {
        const label = this.broken
          ? `${this.title}: video unavailable`
          : playing
            ? `Pause ${this.title}`
            : `Play ${this.title}`;
        this.frameToggle.setAttribute('aria-label', label);
      }

      if (this.muteBtn) {
        this.muteBtn.setAttribute(
          'aria-label',
          silent ? `Unmute ${this.title}` : `Mute ${this.title}`
        );
        this.muteBtn.classList.toggle('is-muted', silent);

        // Icons: .icon-muted is shown when silent, .icon-unmuted when sound is on.
        const mutedIcon = this.muteBtn.querySelector('.icon-muted');
        const soundIcon = this.muteBtn.querySelector('.icon-unmuted');
        if (mutedIcon) mutedIcon.style.display = silent ? 'block' : 'none';
        if (soundIcon) soundIcon.style.display = silent ? 'none' : 'block';
      }

      if (this.pill) {
        this.pill.classList.toggle('muted', silent);
        this.pill.classList.toggle('is-muted', silent);
      }

      if (this.slider) {
        this.slider.value = prefs.volume;
        this.slider.setAttribute('aria-valuetext', `${Math.round(prefs.volume * 100)}%`);
      }
    }

    async play() {
      if (this.broken) return;
      this.load();

      // Only one video plays at a time.
      cards.forEach(other => {
        if (other !== this && !other.video.paused) other.stop();
      });

      this.autoMuted = false;
      this.applyAudio();

      if (this.video.readyState < 3) this.card.classList.add('is-loading');

      try {
        await this.video.play();
      } catch (err) {
        if (err.name === 'AbortError') return; // interrupted by pause: expected

        if (err.name === 'NotAllowedError') {
          // Browser blocked sound: play muted. The next click turns sound on.
          this.autoMuted = true;
          this.applyAudio();
          try {
            await this.video.play();
          } catch (err2) {
            this.handlePlayError(err2);
          }
          return;
        }

        this.handlePlayError(err);
      }
    }

    handlePlayError(err) {
      if (err.name === 'AbortError') return;
      if (err.name === 'NotSupportedError') {
        this.markBroken();
      } else {
        this.autoMuted = false;
        this.applyAudio();
        this.sync();
      }
    }

    stop() {
      this.video.pause();
    }

    handleToggle() {
      if (this.broken) return;

      if (!this.video.paused && this.autoMuted) {
        // Playing muted because the browser blocked sound: this click turns sound on.
        prefs.muted = false;
        if (prefs.volume === 0) prefs.volume = DEFAULT_VOLUME;
        applyAll();
        return;
      }

      if (this.video.paused) this.play();
      else this.stop();
    }

    seek(delta) {
      if (this.broken) return;
      this.load();
      const v = this.video;

      if (v.readyState < 1) {
        v.addEventListener('loadedmetadata', () => this.seek(delta), { once: true });
        return;
      }

      const max = Number.isFinite(v.duration) ? v.duration : Infinity;
      v.currentTime = clamp(v.currentTime + delta, 0, max);
    }

    onKeydown(e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.target instanceof HTMLInputElement && e.target.type === 'range') return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.seek(-SKIP_SEC);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.seek(SKIP_SEC);
      }
    }

    markBroken() {
      this.broken = true;
      this.autoMuted = false;
      this.video.pause();
      this.card.classList.remove('is-loading');
      if (this.frameToggle) this.frameToggle.setAttribute('aria-disabled', 'true');
      this.sync();
    }
  }

  // ---------- Lazy loading and auto-pause ----------
  function setupObservers() {
    if (!('IntersectionObserver' in window)) {
      cards.forEach(c => c.load());
      return;
    }

    const byFrame = new Map(cards.map(c => [c.frame, c]));

    // Load shortly before a card scrolls into view.
    const loader = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        byFrame.get(entry.target).load();
        loader.unobserve(entry.target);
      });
    }, { rootMargin: '300px 0px' });

    // Pause when less than 30% of the frame is visible.
    const pauser = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting && entry.intersectionRatio >= PAUSE_RATIO) return;
        const c = byFrame.get(entry.target);
        if (c && !c.video.paused) c.stop();
      });
    }, { threshold: [0, PAUSE_RATIO] });

    cards.forEach(c => {
      loader.observe(c.frame);
      pauser.observe(c.frame);
    });
  }

  // ---------- Cursor light (desktop mouse only) ----------
  function setCursor(x, y) {
    root.style.setProperty('--mx', x + 'px');
    root.style.setProperty('--my', y + 'px');
  }

  let cursorRaf = 0;
  let cursorX = 0;
  let cursorY = 0;

  window.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || !mqFine.matches) return;
    cursorX = e.clientX;
    cursorY = e.clientY;
    if (!cursorRaf) {
      cursorRaf = requestAnimationFrame(() => {
        cursorRaf = 0;
        setCursor(cursorX, cursorY);
      });
    }
  }, { passive: true });

  // Pointer left the window: hide the light.
  document.addEventListener('mouseout', e => {
    if (!e.relatedTarget) setCursor(-500, -500);
  });

  // ---------- Clipboard ----------
  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) { /* fall through to execCommand */ }
    }

    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);

    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (_) {
      ok = false;
    }
    ta.remove();
    return ok;
  }

  function setupEmail() {
    const btn = document.getElementById('copyEmailBtn');
    if (!btn) return;

    const label = btn.querySelector('.btn-label');
    const idleText = label ? label.textContent : 'Email';
    const status = document.getElementById('copyStatus');
    let resetTimer = 0;

    btn.addEventListener('click', async e => {
      // Touch devices: let the mailto: link open the mail app.
      if (mqCoarse.matches) return;

      e.preventDefault();

      let ok = false;
      try {
        ok = await copyText(EMAIL);
      } catch (_) {
        ok = false;
      }

      if (!ok) {
        // Copy failed: fall back to the mail app.
        window.location.href = 'mailto:' + EMAIL;
        return;
      }

      if (label) label.textContent = 'Copied!';
      btn.classList.add('copied');
      if (status) status.textContent = 'Email address copied to clipboard';

      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        if (label) label.textContent = idleText;
        btn.classList.remove('copied');
        if (status) status.textContent = '';
      }, 2000);
    });
  }

  // ---------- In-page navigation ----------
  function setupNavigation() {
    document.addEventListener('click', e => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const link = e.target.closest('a[href^="#"]');
      if (!link) return;

      const id = link.getAttribute('href').slice(1);
      const target = document.getElementById(id);
      if (!target) return;

      e.preventDefault();

      const behavior = mqReduce.matches ? 'auto' : 'smooth';

      // On mobile, "Works" centers the first card so scroll-snap lands on it.
      const useFirstCard = id === 'works' && mqMobile.matches && cards.length > 0;
      const dest = useFirstCard ? cards[0].card : target;
      dest.scrollIntoView({
        behavior,
        block: dest === target ? 'start' : 'center'
      });

      target.setAttribute('tabindex', '-1');
      target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
      target.focus({ preventScroll: true });

      history.replaceState(null, '', '#' + id);
    });
  }

  // ---------- Global keyboard shortcuts ----------
  function isEditable(el) {
    return el instanceof HTMLElement &&
      (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  }

  function setupKeyboard() {
    document.addEventListener('keydown', e => {
      if (e.defaultPrevented || e.repeat) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (isEditable(e.target)) return;

      const key = (e.key || '').toLowerCase();

      if (key === 'm') {
        e.preventDefault();
        toggleMute();
      } else if (key === 'k') {
        const target = cards.find(c => !c.video.paused) || cards[0];
        if (target) {
          e.preventDefault();
          target.handleToggle();
        }
      }
    });
  }

  // ---------- Tab visibility ----------
  function setupVisibility() {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      cards.forEach(c => {
        if (!c.video.paused) c.stop();
      });
    });
  }

  // ---------- Init ----------
  function init() {
    cards = Array.from(document.querySelectorAll('.work-card'))
      .map(el => (el.querySelector('video') ? new WorkCard(el) : null))
      .filter(Boolean);

    setupObservers();
    setupEmail();
    setupNavigation();
    setupKeyboard();
    setupVisibility();
  }

  init();
})();