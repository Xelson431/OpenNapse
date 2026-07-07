import { useEffect, useRef, useState } from 'react'
import type { AuthStatus } from './use-auth-status'
import { ensurePersonalWorkspaceForCurrentSession } from './ensure-personal-workspace'
import { logger } from '../lib/logger'

const BOOTSTRAP_TIMEOUT_MS = 15_000

export type PersonalWorkspaceBootstrapStatus = {
  mode: 'idle' | 'bootstrapping' | 'ready' | 'failed'
  label: string
  description: string
  workspaceId?: string
}

const idleStatus: PersonalWorkspaceBootstrapStatus = {
  mode: 'idle',
  label: 'Bootstrap waiting',
  description: 'Sign in to create or confirm the personal workspace scaffold.',
}

const bootstrappingStatus: PersonalWorkspaceBootstrapStatus = {
  mode: 'bootstrapping',
  label: 'Bootstrapping workspace',
  description: 'Creating or confirming the personal workspace in Supabase.',
}

export function usePersonalWorkspaceBootstrap(authStatus: AuthStatus): PersonalWorkspaceBootstrapStatus {
  const attemptedForUserId = useRef<string | null>(null)
  const [status, setStatus] = useState<PersonalWorkspaceBootstrapStatus | null>(null)

  useEffect(() => {
    if (authStatus.mode !== 'signed-in' || !authStatus.userId) {
      attemptedForUserId.current = null
      return
    }

    const userId = authStatus.userId

    if (attemptedForUserId.current === userId) return
    attemptedForUserId.current = userId

    logger.info('bootstrap', 'Starting workspace bootstrap', { userId })

    void (async () => {
      setStatus(bootstrappingStatus)

      try {
        const result = await Promise.race([
          ensurePersonalWorkspaceForCurrentSession({
            id: userId,
            email: authStatus.email,
          }),
          timeout(BOOTSTRAP_TIMEOUT_MS),
        ])

        if (result.ok) {
          logger.info('bootstrap', 'Workspace bootstrap succeeded', { workspaceId: result.workspaceId, message: result.message })
          setStatus({
            mode: 'ready',
            label: 'Workspace ready',
            description: result.message,
            workspaceId: result.workspaceId,
          })
          return
        }

        logger.error('bootstrap', `Bootstrap failed: ${result.message}`)
        setStatus({
          mode: 'failed',
          label: 'Bootstrap failed',
          description: result.message,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error('bootstrap', `Bootstrap threw: ${message}`)
        setStatus({
          mode: 'failed',
          label: 'Bootstrap failed',
          description: message.includes('Timed out')
            ? 'Timed out contacting server. Check your Supabase URL and run pending migrations.'
            : message,
        })
      }
    })()
  }, [authStatus.mode, authStatus.userId, authStatus.email])

  if (authStatus.mode !== 'signed-in' || !authStatus.userId) return idleStatus
  return status ?? bootstrappingStatus
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out')), ms))
}
