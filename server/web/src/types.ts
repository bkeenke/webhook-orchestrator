export interface Source {
  id: string
  name: string
  path: string
  methods?: string[]
  sync_response: boolean
  rules: Rule[]
}

export interface Rule {
  id: string
  name: string
  logic: 'AND' | 'OR'
  conditions: Condition[]
  targets: string[]
}

export interface Condition {
  field: string
  any_field?: string[]
  op: string
  value: string
  values?: string[]
}

export interface Target {
  id: string
  url: string
  timeout: string
  headers: Record<string, string>
  forward_ip: boolean
  primary: boolean
  retry: RetryConfig
}

export interface RetryConfig {
  enabled: boolean
  max_attempts: number
  interval: string
  backoff: 'fixed' | 'exponential'
  disable_on_status: number[]
  disable_on_body_contains: string[]
}

export interface LogSummary {
  id: string
  timestamp: string
  method: string
  path: string
  client_ip: string
  source_name: string
  body_size: number
  targets: string[]
}

export interface LogEntry extends LogSummary {
  headers: Record<string, string>
  body: string
  target_responses: Record<string, { status: number; body: string; error?: string }>
}

export interface LogsPage {
  total: number
  items: LogSummary[]
}

export interface LogFilters {
  sources: string[]
  targets: string[]
}
