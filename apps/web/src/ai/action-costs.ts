import type { AIActionType } from './provider'

export const DAILY_FREE_AI_CREDITS = 10

export const AI_ACTION_COSTS: Record<AIActionType, number> = {
  'connection-test': 0,
  'promote-idea-suggestions': 1,
  'weekly-digest': 2,
} as const

export function getAIActionCost(actionType: AIActionType): number {
  return AI_ACTION_COSTS[actionType]
}
