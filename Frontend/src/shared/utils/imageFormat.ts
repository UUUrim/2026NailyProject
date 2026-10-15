// 이미지 생성 API(OpenAI)가 받는 형식은 png / jpeg / gif / webp 뿐이다.
// avif 같은 형식은 브라우저는 그릴 수 있어도 서버가 그대로 넘기면 400(invalid_image_format)이 나므로,
// 업로드 전에 브라우저에서 PNG로 변환한다. (heic는 Chrome이 디코딩하지 못해 변환에 실패할 수 있다.)
const SUPPORTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export async function ensureSupportedImage(file: File): Promise<File> {
    if (SUPPORTED_TYPES.has(file.type)) return file

    const bitmap = await createImageBitmap(file)
    try {
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('canvas를 만들 수 없어요.')
        ctx.drawImage(bitmap, 0, 0)

        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
        if (!blob) throw new Error('이미지를 변환하지 못했어요.')

        const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo'
        return new File([blob], `${baseName}.png`, { type: 'image/png', lastModified: Date.now() })
    } finally {
        bitmap.close()
    }
}
