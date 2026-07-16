import type { NailDesignPreferences } from '@/constants/designPreferences'

export type PersonalColorRecommendation = {
  /** e.g. "spring_light" */
  seasonCode: string
  /** optional debug payload */
  meta?: Record<string, unknown>
}

export type PersonalColorRecommenderInput = {
  /**
   * A single frame image blob captured from the camera stream.
   * Suggested: JPEG/PNG.
   */
  frame: Blob
}

export type PersonalColorRecommender = {
  recommend: (input: PersonalColorRecommenderInput) => Promise<PersonalColorRecommendation | null>
}

export type NailDesignImage = {
  /** absolute URL, relative URL, or data URL */
  src: string
  alt?: string
}

export type NailDesignGenerateInput = {
  prompt: string
  preferences: NailDesignPreferences
}

export type NailDesignGenerateOutput = {
  images: NailDesignImage[]
  meta?: Record<string, unknown>
}

export type NailDesignGenerator = {
  generate: (input: NailDesignGenerateInput) => Promise<NailDesignGenerateOutput>
}

export class AiNotConfiguredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiNotConfiguredError'
  }
}
