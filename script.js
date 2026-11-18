// Копирование email
const emailBtn = document.getElementById("copyEmailBtn");

if (emailBtn) {
  const label = emailBtn.querySelector(".btn-label");
  let feedbackTimeout;

  function showFeedback(message, copied = false) {
    clearTimeout(feedbackTimeout);

    if (label) {
      label.textContent = message;
    }

    emailBtn.classList.toggle("copied", copied);

    feedbackTimeout = setTimeout(() => {
      if (label) {
        label.textContent = "Email";
      }

      emailBtn.classList.remove("copied");
    }, 2000);
  }

  function fallbackCopy(text) {
    const textarea = document.createElement("textarea");

    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";

    document.body.appendChild(textarea);
    textarea.select();

    let success = false;

    try {
      success = document.execCommand("copy");
    } catch (error) {
      success = false;
    }

    textarea.remove();
    return success;
  }

  emailBtn.addEventListener("click", async () => {
    const email = emailBtn.dataset.email;
    let copied = false;

    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(email);
        copied = true;
      } catch (error) {
        copied = fallbackCopy(email);
      }
    } else {
      copied = fallbackCopy(email);
    }

    if (copied) {
      showFeedback("Copied!", true);
    } else {
      window.location.href = `mailto:${email}`;
      showFeedback("Opening email");
    }
  });
}

// Прокрутка к работам и наверх
document.addEventListener("click", (event) => {
  const link = event.target.closest("[data-scroll]");

  if (!link) return;

  const selector = link.getAttribute("data-scroll");
  const isMobile = window.matchMedia("(max-width: 720px)").matches;
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  const target =
    selector === "#works" && isMobile
      ? document.querySelector(".work-card")
      : document.querySelector(selector);

  if (!target) return;

  event.preventDefault();

  target.scrollIntoView({
    behavior: reduceMotion ? "instant" : "smooth",
    block: selector === "#works" && isMobile ? "center" : "start"
  });
});

// Подсветка курсора на ПК
const cursorGlow = document.getElementById("cursorGlow");
const gridLit = document.getElementById("gridLit");

const canHover = window.matchMedia(
  "(hover: hover) and (pointer: fine)"
).matches;

if (canHover) {
  window.addEventListener(
    "pointermove",
    (event) => {
      const x = `${event.clientX}px`;
      const y = `${event.clientY}px`;

      [cursorGlow, gridLit].forEach((element) => {
        if (!element) return;

        element.style.setProperty("--mx", x);
        element.style.setProperty("--my", y);
      });
    },
    { passive: true }
  );
}

// Иконки звука
const videoIcons = {
  sound: `
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6.5 9H3.5v6h3L11 19V5z"/>
      <path d="M15 9a4.5 4.5 0 0 1 0 6"/>
      <path d="M17.8 6.5a8 8 0 0 1 0 11"/>
    </svg>
  `,

  muted: `
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6.5 9H3.5v6h3L11 19V5z"/>
      <path d="m15 9 5 6m0-6-5 6"/>
    </svg>
  `
};

const videos = Array.from(document.querySelectorAll(".work-video"));

// Управление роликами
document.querySelectorAll(".work-card").forEach((card, index) => {
  const video = card.querySelector(".work-video");
  const toggleButton = card.querySelector(".video-toggle");
  const muteButton = card.querySelector(".video-mute");
  const volumeSlider = card.querySelector(".video-volume");

  if (!video || !toggleButton || !muteButton || !volumeSlider) return;

  const videoNumber = index + 1;
  let lastVolume = 1;

  function updatePlaybackLabel() {
    toggleButton.setAttribute(
      "aria-label",
      `${video.paused ? "Play" : "Pause"} video ${videoNumber}`
    );
  }

  function updateVolumeUI() {
    const silent = video.muted || video.volume === 0;
    const effectiveVolume = silent ? 0 : video.volume;

    muteButton.innerHTML = silent ? videoIcons.muted : videoIcons.sound;

    muteButton.setAttribute(
      "aria-label",
      `${silent ? "Unmute" : "Mute"} video ${videoNumber}`
    );

    volumeSlider.value = effectiveVolume;
    volumeSlider.style.setProperty(
      "--volume",
      `${effectiveVolume * 100}%`
    );
  }

  async function togglePlay() {
    if (video.paused) {
      try {
        await video.play();
      } catch (error) {
        console.error("Could not play video:", error);
      }
    } else {
      video.pause();
    }
  }

  toggleButton.addEventListener("click", togglePlay);

  video.addEventListener("play", () => {
    videos.forEach((otherVideo) => {
      if (otherVideo !== video) {
        otherVideo.pause();
      }
    });

    updatePlaybackLabel();
  });

  video.addEventListener("pause", updatePlaybackLabel);

  muteButton.addEventListener("click", () => {
    if (video.muted || video.volume === 0) {
      if (video.volume === 0) {
        video.volume = lastVolume;
      }

      video.muted = false;
    } else {
      lastVolume = video.volume;
      video.muted = true;
    }

    updateVolumeUI();
  });

  volumeSlider.addEventListener("input", () => {
    const volume = Number(volumeSlider.value);

    video.volume = volume;
    video.muted = volume === 0;

    if (volume > 0) {
      lastVolume = volume;
    }

    updateVolumeUI();
  });

  video.addEventListener("volumechange", updateVolumeUI);

  updatePlaybackLabel();
  updateVolumeUI();
});

// Пауза, когда видео почти полностью вышло из видимой области
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.intersectionRatio < 0.25) {
          entry.target.pause();
        }
      });
    },
    { threshold: [0, 0.25] }
  );

  videos.forEach((video) => observer.observe(video));
}

// Пауза при переключении на другую вкладку или приложение
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    videos.forEach((video) => video.pause());
  }
});