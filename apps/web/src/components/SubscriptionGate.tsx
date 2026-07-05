import type { ReactNode } from 'react'
import type { SubscriptionStatus } from '../auth/billing'

function hasSubscriptionFeature(subscription: SubscriptionStatus, feature: string): boolean {
  return Boolean(subscription.features[feature])
}

export function SubscriptionGate({ subscription, feature, fallback = null, children }: {
  subscription: SubscriptionStatus
  feature: string
  fallback?: ReactNode
  children: ReactNode
}) {
  return hasSubscriptionFeature(subscription, feature) ? children : fallback
}
