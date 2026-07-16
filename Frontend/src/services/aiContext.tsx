import { createContext, useContext } from 'react'
import { AiNotConfiguredError, type NailDesignGenerator, type PersonalColorRecommender } from './aiTypes'

const defaultPersonalColorRecommender: PersonalColorRecommender = {
  recommend: async () => null,
}

const defaultNailDesignGenerator: NailDesignGenerator = {
  generate: async () => {
    throw new AiNotConfiguredError(
      'NailDesignGenerator is not configured. Provide a generator via NailDesignGeneratorContext.',
    )
  },
}

export const PersonalColorRecommenderContext = createContext<PersonalColorRecommender>(
  defaultPersonalColorRecommender,
)

export const NailDesignGeneratorContext = createContext<NailDesignGenerator>(defaultNailDesignGenerator)

export function usePersonalColorRecommender(): PersonalColorRecommender {
  return useContext(PersonalColorRecommenderContext)
}

export function useNailDesignGenerator(): NailDesignGenerator {
  return useContext(NailDesignGeneratorContext)
}

