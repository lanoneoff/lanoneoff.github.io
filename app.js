(() => {
  'use strict';

  const DEFAULT_VOLUME = 0.6;

  const prefs = {
    volume: DEFAULT_VOLUME,
    lastVolume: DEFAULT_VOLUME,
    muted: false
  };

  const finePointer = typeof window.matchMedia === 'function'
    ? window.matchMedia('(hover: hover) and (pointer: fine)')
    : { matches: false };

  let cards = [];
  let initialized = false;
  let copiedTimer = 0;

  const clamp = (value, min, max) =>
    Math.min(max, Math.max(min, value));

  const isSilent = () =>
    prefs.muted || prefs.volume === 0;

  function enableSound() {
    if (prefs.volume === 0) {
      prefs.volume = prefs.lastVolume || DEFAULT_VOLUME;
    }

    prefs.muted = false;
  }

  function applyAllCards() {
    cards.forEach(card => {
      card.applyAudio();
      card.sync();
    });
  }

  function stopOtherCards(activeCard) {
    cards.forEach(card => {
      if (
        card !== activeCard &&
        (card.mode !== 'idle' || !card.video.paused)
      ) {
        card.stop();
      }
    });
  }

  function isFinePointerEvent(event) {
    return finePointer.matches && (
      !event.pointerType ||
      event.pointerType === 'mouse' ||
      event.pointerType === 'pen'
    );
  }

  class VideoCard {
    constructor(element, index) {
      this.el = element;
      this.video = element.querySelector('.work-video');
      this.frame = element.querySelector('.frame') || element;
      this.toggle = element.querySelector('.frame-toggle');
      this.muteButton = element.querySelector('.mute-btn');
      this.slider = element.querySelector('.vol-slider');
      this.pill = element.querySelector('.sound-pill');
      this.number = element.dataset.videoNumber || String(index + 1);

      this.mode = 'idle'; // idle | hover | manual
      this.fallbackMuted = false;
      this.broken = false;
      this.pendingReset = false;
      this.playToken = 0;
      this.loadRequested =
        this.video.readyState > 0 ||
        this.video.networkState === 2;

      this.video.removeAttribute('controls');
      this.video.setAttribute('playsinline', '');
      this.video.setAttribute('webkit-playsinline', '');

      this.video.addEventListener('loadedmetadata', () => {
        this.handleMetadata();
      });

      this.video.addEventListener('loadeddata', () => {
        if (this.pendingReset && this.video.paused) {
          this.seekToFirstFrame();
        }
      });

      this.video.addEventListener('play', () => {
        if (this.mode === 'idle') {
          this.pauseVideo();
          return;
        }

        this.sync();
      });

      this.video.addEventListener('playing', () => {
        if (this.mode === 'idle') {
          this.pauseVideo();
          return;
        }

        this.el.classList.remove('is-loading');
        this.sync();
      });

      this.video.addEventListener('waiting', () => {
        if (this.mode !== 'idle') {
          this.el.classList.add('is-loading');
        }
      });

      this.video.addEventListener('stalled', () => {
        if (this.mode !== 'idle') {
          this.el.classList.add('is-loading');
        }
      });

      this.video.addEventListener('pause', () => {
        this.handlePause();
      });

      this.video.addEventListener('ended', () => {
        if (this.video.loop) return;

        this.mode = 'idle';
        this.fallbackMuted = false;
        this.playToken += 1;
        this.el.classList.remove('is-loading');
        this.applyAudio();
        this.sync();
      });

      this.video.addEventListener('error', () => {
        this.markBroken();
      });

      this.video.addEventListener('volumechange', () => {
        this.sync();
      });

      if (this.toggle) {
        this.toggle.addEventListener('click', event => {
          event.preventDefault();
          this.togglePlayback();
        });
      }

      if (this.muteButton) {
        this.muteButton.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          this.toggleMute();
        });
      }

      if (this.slider) {
        this.slider.addEventListener('pointerdown', event => {
          event.stopPropagation();
        });

        this.slider.addEventListener('click', event => {
          event.stopPropagation();
        });

        this.slider.addEventListener('input', () => {
          this.changeVolume();
        });
      }

      this.el.addEventListener('pointerenter', event => {
        if (!isFinePointerEvent(event)) return;
        this.startHoverPreview();
      });

      this.el.addEventListener('pointerleave', event => {
        if (!isFinePointerEvent(event)) return;

        if (this.mode === 'hover') {
          this.stop({ reset: true });
        }
      });

      this.applyAudio();
      this.sync();

      if (this.video.error) {
        this.markBroken();
      } else if (this.video.readyState >= 1) {
        this.handleMetadata();
      }
    }

    handleMetadata() {
      this.loadRequested = true;

      if (
        this.mode === 'idle' ||
        (this.mode === 'hover' && this.pendingReset)
      ) {
        this.seekToFirstFrame();
      }
    }

    seekToFirstFrame() {
      if (this.video.readyState < 1) {
        this.pendingReset = true;
        return;
      }

      try {
        const duration = this.video.duration;
        const time = Number.isFinite(duration) && duration > 0
          ? Math.min(0.01, duration / 2)
          : 0.01;

        if (Math.abs(this.video.currentTime - time) <= 0.001) {
          this.pendingReset = false;
          return;
        }

        this.video.currentTime = time;
        this.pendingReset = false;
      } catch {
        this.pendingReset = true;
      }
    }

    handlePause() {
      if (!this.video.paused) {
        this.sync();
        return;
      }

      this.el.classList.remove('is-loading');

      if (this.mode !== 'idle') {
        this.mode = 'idle';
        this.fallbackMuted = false;
        this.playToken += 1;
        this.applyAudio();
      }

      this.sync();
    }

    pauseVideo() {
      if (!this.video.paused) {
        this.video.pause();
      }
    }

    applyAudio() {
      if (!this.video) return;

      const forceMuted =
        this.mode === 'hover' ||
        this.fallbackMuted ||
        isSilent();

      try {
        this.video.volume = prefs.volume;
      } catch {
        // Некоторые мобильные браузеры не разрешают задавать громкость.
      }

      try {
        this.video.muted = forceMuted;
      } catch {
        // Не прерываем работу карточки, если браузер ограничивает свойство.
      }
    }

    sync() {
      if (!this.video) return;

      const playing = !this.video.paused && !this.video.ended;
      const muted =
        this.mode === 'hover' ||
        this.fallbackMuted ||
        isSilent();

      this.el.classList.toggle('is-playing', playing);
      this.el.classList.toggle('is-broken', this.broken);

      if (this.toggle) {
        this.toggle.disabled = this.broken;
        this.toggle.setAttribute('aria-pressed', String(playing));

        let label;

        if (playing && this.mode === 'hover') {
          label = `Enable sound and continue video ${this.number}`;
        } else if (playing) {
          label = `Pause video ${this.number}`;
        } else if (this.mode === 'manual') {
          label = `Cancel loading video ${this.number}`;
        } else {
          label = `Play video ${this.number}`;
        }

        this.toggle.setAttribute('aria-label', label);
      }

      if (this.pill) {
        this.pill.classList.toggle('muted', muted);
      }

      if (this.muteButton) {
        this.muteButton.setAttribute('aria-pressed', String(muted));
        this.muteButton.setAttribute(
          'aria-label',
          muted
            ? `Unmute video ${this.number}`
            : `Mute video ${this.number}`
        );
      }

      if (this.slider) {
        this.slider.value = String(prefs.volume);
        this.slider.style.setProperty(
          '--val',
          `${Math.round(prefs.volume * 100)}%`
        );
        this.slider.setAttribute(
          'aria-label',
          `Volume for video ${this.number}`
        );
        this.slider.setAttribute(
          'aria-valuetext',
          `${Math.round(prefs.volume * 100)}%`
        );
      }
    }

    load() {
      if (this.loadRequested || this.broken) return;

      this.loadRequested = true;

      try {
        this.video.load();
      } catch {
        // Ошибка загрузки будет обработана событием video.error.
      }
    }

    start(mode) {
      if (this.broken) return;

      stopOtherCards(this);

      this.mode = mode;
      this.fallbackMuted = false;

      if (mode === 'hover') {
        this.seekToFirstFrame();
      } else {
        this.pendingReset = false;
      }

      this.load();
      this.applyAudio();

      const token = ++this.playToken;

      if (this.video.paused) {
        this.el.classList.add('is-loading');
      }

      this.sync();
      this.requestPlay(token, mode === 'manual');
    }

    requestPlay(token, allowMutedFallback) {
      let result;

      try {
        result = this.video.play();
      } catch (error) {
        this.handlePlayFailure(error, token, allowMutedFallback);
        return;
      }

      if (!result || typeof result.then !== 'function') return;

      result.then(
        () => {
          if (token !== this.playToken || this.mode === 'idle') {
            return;
          }

          this.el.classList.remove('is-loading');
          this.sync();
        },
        error => {
          this.handlePlayFailure(error, token, allowMutedFallback);
        }
      );
    }

    handlePlayFailure(error, token, allowMutedFallback) {
      if (token !== this.playToken || this.mode === 'idle') {
        return;
      }

      const blockedByAudio =
        error &&
        error.name === 'NotAllowedError' &&
        allowMutedFallback &&
        this.mode === 'manual' &&
        !this.video.muted &&
        !isSilent() &&
        !this.fallbackMuted;

      if (blockedByAudio) {
        this.fallbackMuted = true;
        this.applyAudio();
        this.el.classList.add('is-loading');
        this.requestPlay(token, false);
        return;
      }

      const unsupported =
        error && error.name === 'NotSupportedError';

      this.mode = 'idle';
      this.fallbackMuted = false;
      this.playToken += 1;
      this.el.classList.remove('is-loading');
      this.pauseVideo();
      this.applyAudio();
      this.sync();

      if (unsupported) {
        this.markBroken();
      }
    }

    startHoverPreview() {
      if (
        this.broken ||
        this.mode !== 'idle' ||
        !this.video.paused
      ) {
        return;
      }

      // Предпросмотр при наведении на компьютере запускается без звука.
      this.start('hover');
    }

    togglePlayback() {
      if (this.broken) return;

      // Повторный клик отменяет ещё не завершившийся запуск.
      if (this.mode === 'manual' && this.video.paused) {
        this.stop();
        return;
      }

      // Повторный клик ставит обычное воспроизведение на паузу.
      // Тихое превью при наведении — исключение: клик включает звук.
      if (!this.video.paused && this.mode !== 'hover') {
        this.stop();
        return;
      }

      enableSound();
      this.fallbackMuted = false;

      this.start('manual');
      applyAllCards();
    }

    toggleMute() {
      if (this.mode === 'hover') {
        enableSound();
        this.start('manual');
        applyAllCards();
        return;
      }

      if (this.fallbackMuted || isSilent()) {
        this.fallbackMuted = false;
        enableSound();
      } else {
        prefs.muted = true;
      }

      applyAllCards();
    }

    changeVolume() {
      const value = Number.parseFloat(this.slider.value);
      if (!Number.isFinite(value)) return;

      const wasHoverPreview = this.mode === 'hover';

      prefs.volume = clamp(value, 0, 1);

      if (prefs.volume > 0) {
        prefs.lastVolume = prefs.volume;
        prefs.muted = false;
      } else {
        prefs.muted = true;
      }

      if (wasHoverPreview) {
        this.start('manual');
        applyAllCards();
        return;
      }

      this.fallbackMuted = false;
      applyAllCards();
    }

    stop({ reset = false } = {}) {
      if (!this.video) return;

      const wasHoverPreview = this.mode === 'hover';

      this.mode = 'idle';
      this.fallbackMuted = false;
      this.playToken += 1;
      this.el.classList.remove('is-loading');

      this.pauseVideo();

      if (reset || wasHoverPreview) {
        this.seekToFirstFrame();
      }

      this.applyAudio();
      this.sync();
    }

    markBroken() {
      if (this.broken) return;

      this.broken = true;
      this.mode = 'idle';
      this.fallbackMuted = false;
      this.playToken += 1;
      this.el.classList.remove('is-loading');

      this.pauseVideo();
      this.applyAudio();
      this.sync();
    }
  }

  async function copyText(text) {
    if (
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        // Если Clipboard API недоступен, используем запасной способ.
      }
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';

    let copied = false;

    try {
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, text.length);

      copied = Boolean(
        document.execCommand &&
        document.execCommand('copy')
      );
    } catch {
      copied = false;
    } finally {
      textarea.remove();
    }

    if (!copied) {
      throw new Error('Could not copy email address');
    }
  }

  function setupEmailButton() {
    const button = document.getElementById('copyEmailBtn');
    if (!button) return;

    const coarsePointer = typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)')
      : { matches: false };

    button.addEventListener('click', async event => {
      // На телефоне оставляем стандартное открытие почтового приложения.
      if (coarsePointer.matches) return;

      event.preventDefault();

      const label = button.querySelector('.btn-label');

      try {
        await copyText('editorafterwork@gmail.com');

        if (label) {
          label.textContent = 'Copied!';
        }

        button.classList.add('copied');
        window.clearTimeout(copiedTimer);

        copiedTimer = window.setTimeout(() => {
          if (label) {
            label.textContent = 'Email';
          }

          button.classList.remove('copied');
        }, 2000);
      } catch {
        window.location.href =
          button.getAttribute('href') ||
          'mailto:editorafterwork@gmail.com';
      }
    });
  }

  function setupWorksNavigation() {
    const worksLink = document.querySelector('.scroll-btn');
    const firstCard = document.querySelector('.work-card');

    if (!worksLink || !firstCard) return;

    const mobileLayout = window.matchMedia('(max-width: 720px)');

    worksLink.addEventListener('click', event => {
      // На компьютере работает обычная ссылка на секцию Works.
      if (!mobileLayout.matches) return;

      event.preventDefault();

      const reducedMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
      ).matches;

      firstCard.scrollIntoView({
        behavior: reducedMotion ? 'auto' : 'smooth',
        block: 'center',
        inline: 'nearest'
      });
    });
  }

  function init() {
    if (initialized) return;
    initialized = true;

    const elements = Array.from(
      document.querySelectorAll('.work-card')
    ).filter(element =>
      element.querySelector('.work-video') &&
      element.querySelector('.frame-toggle')
    );

    cards = elements.map((element, index) => {
      return new VideoCard(element, index);
    });

    if ('IntersectionObserver' in window) {
      const cardByElement = new Map(
        cards.map(card => [card.el, card])
      );

      const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          const card = cardByElement.get(entry.target);
          if (!card) return;

          // Оставляем видео активным, пока видно не меньше 20% карточки.
          if (
            entry.isIntersecting &&
            entry.intersectionRatio >= 0.2
          ) {
            return;
          }

          if (card.mode !== 'idle' || !card.video.paused) {
            card.stop({ reset: card.mode === 'hover' });
          }
        });
      }, { threshold: [0, 0.2] });

      cards.forEach(card => observer.observe(card.el));
    } else {
      window.addEventListener('scroll', () => {
        cards.forEach(card => {
          if (card.mode === 'idle' && card.video.paused) return;

          const rect = card.frame.getBoundingClientRect();
          const outsideViewport =
            rect.top >= window.innerHeight ||
            rect.bottom <= 0;

          if (outsideViewport) {
            card.stop({ reset: card.mode === 'hover' });
          }
        });
      }, { passive: true });
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;

      cards.forEach(card => {
        if (card.mode !== 'idle' || !card.video.paused) {
          card.stop({ reset: card.mode === 'hover' });
        }
      });
    });

    window.addEventListener('pagehide', () => {
      cards.forEach(card => {
        if (card.mode !== 'idle' || !card.video.paused) {
          card.stop({ reset: card.mode === 'hover' });
        }
      });
    });

    const onPointerModeChange = event => {
      if (event.matches) return;

      cards.forEach(card => {
        if (card.mode === 'hover') {
          card.stop({ reset: true });
        }
      });
    };

    if (typeof finePointer.addEventListener === 'function') {
      finePointer.addEventListener('change', onPointerModeChange);
    } else if (typeof finePointer.addListener === 'function') {
      finePointer.addListener(onPointerModeChange);
    }

    setupEmailButton();
    setupWorksNavigation();

    const root = document.documentElement;

    window.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse' || !finePointer.matches) {
        return;
      }

      root.style.setProperty('--mx', `${event.clientX}px`);
      root.style.setProperty('--my', `${event.clientY}px`);
    }, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();