import { useCallback, useRef, type KeyboardEvent } from "react";

function WireframeThumb() {
  return (
    <div className="thumb wireframe wireframe-thumb" aria-hidden="true">
      <span className="wireframe-x" />
      <span className="wireframe-x" />
    </div>
  );
}

export function GalleryCarousel() {
  const trackRef = useRef<HTMLDivElement>(null);

  const getStep = useCallback(() => {
    const track = trackRef.current;
    if (!track) return 240;
    const first = track.querySelector(".thumb");
    if (!(first instanceof HTMLElement)) return 240;
    const style = window.getComputedStyle(track);
    const gap = Number.parseFloat(style.columnGap || style.gap || "0") || 0;
    return first.getBoundingClientRect().width + gap;
  }, []);

  const scrollByStep = useCallback(
    (dir: number) => {
      trackRef.current?.scrollBy({
        left: getStep() * dir,
        behavior: "smooth",
      });
    },
    [getStep],
  );

  const onViewportKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      scrollByStep(-1);
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      scrollByStep(1);
    }
  };

  return (
    <div className="carousel">
      <button
        className="carousel-btn"
        type="button"
        aria-label="이전"
        onClick={() => scrollByStep(-1)}
      >
        ‹
      </button>

      <div
        className="carousel-viewport"
        tabIndex={0}
        role="region"
        aria-label="갤러리"
        onKeyDown={onViewportKeyDown}
      >
        <div className="carousel-track" ref={trackRef}>
          {Array.from({ length: 6 }, (_, i) => (
            <WireframeThumb key={i} />
          ))}
        </div>
      </div>

      <button
        className="carousel-btn"
        type="button"
        aria-label="다음"
        onClick={() => scrollByStep(1)}
      >
        ›
      </button>
    </div>
  );
}
