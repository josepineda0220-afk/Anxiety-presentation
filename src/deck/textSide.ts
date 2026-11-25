import { createContext } from 'react'
import { DEFAULT_BRAIN_SIDE, type BrainSide } from '../data/sections'

/**
 * The side the brain is shown on, as the text sees it, a couple of frames behind the stage.
 * A context rather than a prop, so a slide that is fading out still follows it.
 */
export const BrainSideContext = createContext<BrainSide>(DEFAULT_BRAIN_SIDE)
