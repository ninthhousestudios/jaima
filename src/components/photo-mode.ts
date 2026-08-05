const PHOTOS = [
  { src: '/images/photos/amma-devi1.png', alt: 'Amma in Devi Bhava' },
  { src: '/images/photos/amma.jpg', alt: 'Amma smiling' },
  { src: '/images/photos/amma1.jpg', alt: 'Amma with garlands' },
  { src: '/images/photos/amma2.jpg', alt: 'Amma portrait' },
  { src: '/images/photos/amma3.jpg', alt: 'Amma portrait' },
  { src: '/images/photos/amma4.jpg', alt: 'Amma portrait' },
  { src: '/images/photos/amma-devi-young.jpg', alt: 'Young Amma in Devi Bhava' },
  { src: '/images/photos/amma-devi-smiling.jpg', alt: 'Amma in Devi Bhava smiling' },
  { src: '/images/photos/amma-devi-standing.jpg', alt: 'Amma in Devi Bhava standing' },
  { src: '/images/photos/amma-krishna.jpg', alt: 'Amma as Krishna' },
  { src: '/images/photos/amma-puja.jpg', alt: 'Amma in puja' },
  { src: '/images/photos/amma-arriving.jpg', alt: 'Amma arriving' },
  { src: '/images/photos/her-feet.jpg', alt: 'Padapuja' },
  { src: '/images/photos/her-feet2.jpg', alt: 'Padapuja' },
];

let currentIndex = 0;
let transitioning = false;

export function getCurrentPhotoSrc(): string {
  return PHOTOS[currentIndex].src;
}

/**
 * `navHost` is passed rather than derived from `darshan.parentElement`: the
 * photo now lives inside the altar's frame aperture, which clips its
 * children, and the arrows belong at the edges of the room.
 */
export function initPhotoMode(darshan: HTMLElement, navHost: HTMLElement) {
  const nav = document.createElement('div');
  nav.className = 'photo-nav mode-overlay';
  nav.id = 'mode-photo';
  nav.innerHTML = `
    <button class="photo-arrow photo-prev" aria-label="Previous photo">‹</button>
    <button class="photo-arrow photo-next" aria-label="Next photo">›</button>
  `;
  navHost.appendChild(nav);

  let currentImg = darshan.querySelector('#darshan-photo') as HTMLImageElement;

  function crossfade(newIndex: number) {
    if (transitioning || newIndex === currentIndex) return;
    transitioning = true;

    const newImg = document.createElement('img');
    newImg.src = PHOTOS[newIndex].src;
    newImg.alt = PHOTOS[newIndex].alt;
    newImg.id = 'darshan-photo';
    newImg.style.opacity = '0';
    newImg.style.transition = 'opacity 1.5s ease';
    darshan.appendChild(newImg);

    const oldImg = currentImg;
    oldImg.style.transition = 'opacity 1.5s ease';

    newImg.decode().then(() => {
      requestAnimationFrame(() => {
        newImg.style.opacity = '1';
        oldImg.style.opacity = '0';

        setTimeout(() => {
          oldImg.remove();
          currentImg = newImg;
          currentIndex = newIndex;
          transitioning = false;
        }, 1500);
      });
    }).catch(() => {
      requestAnimationFrame(() => {
        newImg.style.opacity = '1';
        oldImg.style.opacity = '0';

        setTimeout(() => {
          oldImg.remove();
          currentImg = newImg;
          currentIndex = newIndex;
          transitioning = false;
        }, 1500);
      });
    });
  }

  nav.querySelector('.photo-prev')!.addEventListener('click', () => {
    const idx = (currentIndex - 1 + PHOTOS.length) % PHOTOS.length;
    crossfade(idx);
  });

  nav.querySelector('.photo-next')!.addEventListener('click', () => {
    const idx = (currentIndex + 1) % PHOTOS.length;
    crossfade(idx);
  });
}
