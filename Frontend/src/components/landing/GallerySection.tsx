import { useState } from 'react'
import { GALLERY_IMAGES } from '@/constants/landing'

const VISIBLE_COUNT = 4

export function GallerySection() {
  const [pageIndex, setPageIndex] = useState(0)

  const pageCount = Math.ceil(GALLERY_IMAGES.length / VISIBLE_COUNT)
  const startIndex = pageIndex * VISIBLE_COUNT

  const handlePrev = () => {
    setPageIndex((prev) => (prev - 1 + pageCount) % pageCount)
  }

  const handleNext = () => {
    setPageIndex((prev) => (prev + 1) % pageCount)
  }

  const visibleImages = Array.from({ length: VISIBLE_COUNT }, (_, offset) => {
    const index = (startIndex + offset) % GALLERY_IMAGES.length
    return GALLERY_IMAGES[index]
  })

  return (
    <section className="gallery-section" aria-labelledby="gallery-title">
      <h2 id="gallery-title" className="gallery-section__title">
        둘러보기
      </h2>

      <div className="gallery-section__carousel">
        <button
          type="button"
          className="gallery-section__arrow gallery-section__arrow--prev"
          onClick={handlePrev}
          aria-label="이전 이미지"
        >
          ‹
        </button>

        <div className="gallery-section__track">
          {visibleImages.map((imageSrc, index) => (
            <div key={`${imageSrc}-${index}`} className="gallery-section__item">
              <img src={imageSrc} alt={`네일 이미지 ${index + 1}`} className="gallery-section__image" />
            </div>
          ))}
        </div>

        <button
          type="button"
          className="gallery-section__arrow gallery-section__arrow--next"
          onClick={handleNext}
          aria-label="다음 이미지"
        >
          ›
        </button>
      </div>
    </section>
  )
}
