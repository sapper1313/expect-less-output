/** Model suggestions for the remote Ollama machine. Names are checked against the Ollama library on 2026-10-09
 * (nomic-embed-text, mxbai-embed-large, all-minilm and qwen3-embedding are listed there). Vision names change often,
 * so the screen lets the owner edit the name, and the pull step reports plainly when a name does not exist. */

export interface ModelChoice {
  name: string
  note: string
}

export interface Recommendation {
  tier: 'tiny' | 'small' | 'medium' | 'large'
  vision: ModelChoice[]
  embed: ModelChoice[]
  warning: string | null
}

export function recommendModels(ramGb: number | null, hasGpu: boolean | null): Recommendation {
  const ram = ramGb ?? 8
  const gpu = !!hasGpu
  const embed: ModelChoice[] = [
    { name: 'nomic-embed-text', note: 'small and fast, good default' },
    { name: 'all-minilm', note: 'smallest, for very old machines' },
    { name: 'mxbai-embed-large', note: 'bigger, a little more accurate' },
  ]
  if (ram <= 16 && !gpu)
    return {
      tier: ram <= 8 ? 'tiny' : 'small',
      vision: [
        { name: 'moondream', note: 'smallest vision model, works on CPU only' },
        { name: 'minicpm-v4.6:1b', note: 'small, newer, if your Ollama has it' },
      ],
      embed: embed.slice(0, 2),
      warning:
        'This machine has no graphics card, so each video check by the vision model can take a minute or more. That is fine: checks run in the background and never block posting.',
    }
  if (ram <= 32)
    return {
      tier: 'medium',
      vision: [
        { name: 'qwen2.5vl:3b', note: 'good balance of speed and accuracy' },
        { name: 'gemma3:4b', note: 'good general vision model' },
      ],
      embed: embed.slice(0, 1),
      warning: gpu ? null : 'Without a graphics card expect checks to take around a minute per clip.',
    }
  return {
    tier: 'large',
    vision: [
      { name: 'qwen2.5vl:7b', note: 'more accurate checks' },
      { name: 'gemma3:12b', note: 'strong general vision model' },
    ],
    embed: [embed[2], embed[0]],
    warning: null,
  }
}

/** Plain steps for the other computer (a Dell Latitude today, a bigger machine later). */
export function remoteSetupSteps(): { windows: string[]; linux: string[]; warning: string } {
  const common = (os: 'Windows' | 'Linux'): string[] => [
    `Install Ollama on the ${os} computer from ollama.com/download.`,
    'Make Ollama listen on the network, not just on that computer (steps below for your system).',
    'Allow port 11434 through the firewall for your home network only.',
    'Give the computer a fixed address: set a DHCP reservation in your router, or use a hostname like dell-latitude.local.',
    'Turn off sleep and hibernate so the computer stays on.',
    'Back in Expect Less Output, type the address in the Ollama host box, for example http://192.168.1.50:11434, and press Test.',
  ]
  return {
    windows: [
      ...common('Windows').slice(0, 1),
      'Open the Start menu, type "environment variables", open "Edit environment variables for your account", and add a new variable named OLLAMA_HOST with the value 0.0.0.0',
      'Quit Ollama from the system tray and start it again.',
      'In Windows Defender Firewall, add an inbound rule: TCP port 11434, allow, scope "Private" networks only.',
      ...common('Windows').slice(3),
      'Settings, System, Power: set "Screen and sleep" to Never when plugged in.',
    ],
    linux: [
      ...common('Linux').slice(0, 1),
      'Run: sudo systemctl edit ollama.service and add these two lines under [Service]: Environment="OLLAMA_HOST=0.0.0.0"',
      'Run: sudo systemctl daemon-reload && sudo systemctl restart ollama',
      'Allow the port for your home network only, for example: sudo ufw allow from 192.168.1.0/24 to any port 11434',
      ...common('Linux').slice(3),
      'Run: sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target',
    ],
    warning:
      'NEVER forward port 11434 from your router to the internet. Anyone who found it could use your computer.',
  }
}
