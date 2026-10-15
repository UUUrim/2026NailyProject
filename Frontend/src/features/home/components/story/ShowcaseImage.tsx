import { useState } from 'react'

type ShowcaseImageProps = {
  src: string
  /** 이미지가 아직 없을 때 자리 카드에 보여 줄 번호/이름 */
  placeholder: string
  className?: string
  alt?: string
}

/** 사용자 디자인 이미지. 파일이 없거나 열리지 않으면 그라데이션 자리 카드만 남긴다. */
export function ShowcaseImage({ src, placeholder, className = '', alt = '' }: ShowcaseImageProps) {
  const [failed, setFailed] = useState(false)

  return (
    <span className={`showcase-image${failed ? ' is-missing' : ''}${className ? ` ${className}` : ''}`}>
      <span className="showcase-image__placeholder" aria-hidden="true">
        {placeholder}
      </span>
      {!failed && (
        <img
          src={src}
          alt={alt}
          className="showcase-image__img"
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  )
}
