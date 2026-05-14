export const privacyDefaults = {
  telemetry: false,
  cloudSync: false,
  ai: false,
  hostedAI: false,
} as const

export const securityPrinciples = [
  'Local-first by default',
  'No telemetry without opt-in',
  'AI suggestions are drafts only',
  'Cloud sync must use ownership checks and RLS',
  'Imported data and AI output are untrusted until validated',
]
