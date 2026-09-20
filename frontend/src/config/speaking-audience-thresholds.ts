/** Face-driven auditorium reaction thresholds (debounced in use-audience-reaction). */

export const AUDIENCE_REACT_HOLD_MS = 2500
export const AUDIENCE_REACT_COOLDOWN_MS = 4000

/** Sustained high stress → aud_filled_sad */
export const AUDIENCE_SAD_STRESS = 0.62
export const AUDIENCE_SAD_CONSECUTIVE = 2

/** Strong composure + engagement, low stress → aud_filled_clap */
export const AUDIENCE_CLAP_COMPOSURE = 0.72
export const AUDIENCE_CLAP_ENGAGEMENT = 0.68
export const AUDIENCE_CLAP_MAX_STRESS = 0.45
