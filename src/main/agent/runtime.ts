import { randomBytes } from 'crypto'
import { existsSync } from 'fs'
import { homedir, networkInterfaces } from 'os'
import { join } from 'path'
import type { SecretStore } from '../services/secrets'
import { mask } from '../services/secrets'
import type { SettingsService } from '../services/settings'
import type { AgentStatus, McpConfig } from '@shared/types'
import type { AgentServices } from './core'
import { AgentServer } from './server'

/** This Mac's Tailscale IPv4 address (100.64.0.0 to 100.127.255.255), or null when Tailscale is not running. */
export function tailscaleAddress(interfaces = networkInterfaces()): string | null {
  for (const list of Object.values(interfaces))
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue
      const [a, b] = i.address.split('.').map(Number)
      if (a === 100 && b >= 64 && b <= 127) return i.address
    }
  return null
}

export const AGENT_TOKEN_KEY = 'agent.token'

export interface RuntimePaths {
  /** The built MCP script that ships with the app. */
  scriptPath: string
}

/** Owns the agent token, starts and stops the localhost server to match Settings, and describes the MCP setup. */
export class AgentRuntime {
  readonly server: AgentServer
  private error: string | null = null

  constructor(
    private s: AgentServices,
    private secrets: SecretStore,
    private settings: SettingsService,
    private paths: RuntimePaths,
  ) {
    this.server = new AgentServer(s, () => this.token())
  }

  token(): string | null {
    return this.secrets.get(AGENT_TOKEN_KEY)
  }

  /** A new token replaces the old one at once. The caller shows it one time. */
  generateToken(): string {
    const t = `elo_${randomBytes(32).toString('base64url')}`
    this.secrets.set(AGENT_TOKEN_KEY, t)
    this.s.log.log('info', 'A new agent token was generated. The old one no longer works.')
    return t
  }

  /** Makes the server match the Settings: on or off, and the right port. */
  async apply(): Promise<void> {
    const cfg = this.settings.get()
    this.error = null
    const addr = this.server.address()
    if (!cfg.agentApiEnabled) {
      if (this.server.running) {
        await this.server.stop()
        this.s.log.log('info', 'Agent API turned off.')
      }
      return
    }
    const ts = cfg.agentApiTailscale ? tailscaleAddress() : null
    if (cfg.agentApiTailscale && !ts) {
      this.error =
        'Tailscale does not seem to be running on this Mac, so the API is only on this Mac for now.'
      this.s.log.log('warn', this.error)
    }
    if (
      this.server.running &&
      addr?.port === cfg.agentApiPort &&
      this.server.tailscaleListening === !!ts
    )
      return
    try {
      await this.server.start(cfg.agentApiPort, ts)
      this.s.log.log(
        'info',
        `Agent API listening on 127.0.0.1:${cfg.agentApiPort}${ts ? ` and ${ts}:${cfg.agentApiPort} (Tailscale)` : ''}.`,
      )
    } catch (e) {
      this.error = (e as Error).message
      this.s.log.log('error', `Agent API could not start: ${this.error}`)
    }
  }

  status(): AgentStatus {
    const cfg = this.settings.get()
    const t = this.token()
    return {
      enabled: cfg.agentApiEnabled,
      running: this.server.running,
      port: cfg.agentApiPort,
      tokenSet: !!t,
      tokenMasked: t ? mask(t) : '',
      draftsOnly: !cfg.agentMaySchedule,
      error: this.error,
      tailscaleAddress: tailscaleAddress(),
      tailscaleListening: this.server.tailscaleListening,
    }
  }

  mcpConfig(): McpConfig {
    const port = this.settings.get().agentApiPort
    const candidates = ['/usr/local/bin/node', '/opt/homebrew/bin/node', '/usr/bin/node']
    const nodePath = candidates.find((p) => existsSync(p)) ?? 'node'
    const apiUrl = `http://127.0.0.1:${port}`
    const server = {
      mcpServers: {
        'expect-less-output': {
          command: nodePath,
          args: [this.paths.scriptPath],
          env: { ELO_API_URL: apiUrl, ELO_API_TOKEN: 'PASTE_YOUR_TOKEN_HERE' },
        },
      },
    }
    return {
      nodePath,
      scriptPath: this.paths.scriptPath,
      scriptExists: existsSync(this.paths.scriptPath),
      apiUrl,
      desktopConfigPath: join(
        homedir(),
        'Library',
        'Application Support',
        'Claude',
        'claude_desktop_config.json',
      ),
      desktopJson: JSON.stringify(server, null, 2),
      claudeCodeCommand: `claude mcp add expect-less-output --env ELO_API_URL=${apiUrl} --env ELO_API_TOKEN=PASTE_YOUR_TOKEN_HERE -- ${nodePath} ${this.paths.scriptPath}`,
    }
  }
}
