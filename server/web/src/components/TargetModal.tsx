import { useEffect, useState } from 'react'
import {
  Modal, Stack, TextInput, Switch, Button, Group, Text, Paper,
  SegmentedControl, NumberInput, ActionIcon, Divider, Box,
  TagsInput, ScrollArea,
} from '@mantine/core'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import type { Target, RetryConfig } from '../types'
import { saveTarget } from '../api/client'

function emptyRetry(): RetryConfig {
  return {
    enabled: false,
    max_attempts: 3,
    interval: '5s',
    backoff: 'fixed',
    disable_on_status: [],
    disable_on_body_contains: [],
  }
}

function emptyTarget(): Target {
  return {
    id: '',
    url: '',
    timeout: '30s',
    headers: {},
    forward_ip: false,
    primary: false,
    retry: emptyRetry(),
  }
}

interface HeaderRow {
  key: string
  value: string
}

function headersToRows(h: Record<string, string>): HeaderRow[] {
  return Object.entries(h).map(([key, value]) => ({ key, value }))
}

function rowsToHeaders(rows: HeaderRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const { key, value } of rows) {
    if (key.trim()) out[key.trim()] = value
  }
  return out
}

interface Props {
  opened: boolean
  target: Target | null
  onClose: () => void
}

export function TargetModal({ opened, target, onClose }: Props) {
  const qc = useQueryClient()
  const [form, setForm] = useState<Target>(emptyTarget())
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>([])
  const [originalId, setOriginalId] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (opened) {
      const t = target ? JSON.parse(JSON.stringify(target)) as Target : emptyTarget()
      setForm(t)
      setHeaderRows(headersToRows(t.headers))
      setOriginalId(target?.id)
    }
  }, [opened, target])

  const mutation = useMutation({
    mutationFn: () => {
      const t = { ...form, headers: rowsToHeaders(headerRows) }
      return saveTarget(t, originalId)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['targets'] })
      notifications.show({ message: `Target "${form.id}" saved`, color: 'green' })
      onClose()
    },
    onError: (err: Error) => {
      notifications.show({ title: 'Error', message: err.message, color: 'red' })
    },
  })

  function setField<K extends keyof Target>(k: K, v: Target[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function setRetry<K extends keyof RetryConfig>(k: K, v: RetryConfig[K]) {
    setForm(f => ({ ...f, retry: { ...f.retry, [k]: v } }))
  }

  function addHeader() {
    setHeaderRows(rows => [...rows, { key: '', value: '' }])
  }

  function removeHeader(idx: number) {
    setHeaderRows(rows => rows.filter((_, i) => i !== idx))
  }

  function updateHeader(idx: number, field: 'key' | 'value', val: string) {
    setHeaderRows(rows => rows.map((r, i) => i === idx ? { ...r, [field]: val } : r))
  }

  const isNew = !originalId

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={isNew ? 'Add Target' : `Edit Target: ${originalId}`}
      size="lg"
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <Stack gap="md">
        <TextInput
          label="Target ID"
          placeholder="my-target"
          value={form.id}
          onChange={e => setField('id', e.target.value)}
          required
          disabled={!isNew}
          description={!isNew ? 'ID cannot be changed after creation' : 'Unique identifier for this target'}
        />
        <TextInput
          label="URL"
          placeholder="https://example.com/webhook"
          value={form.url}
          onChange={e => setField('url', e.target.value)}
          required
        />
        <TextInput
          label="Timeout"
          placeholder="30s"
          value={form.timeout}
          onChange={e => setField('timeout', e.target.value)}
          description="e.g. 30s, 1m, 500ms"
        />

        <Group grow>
          <Switch
            label="Forward IP"
            description="Add X-Forwarded-For header"
            checked={form.forward_ip}
            onChange={e => setField('forward_ip', e.target.checked)}
          />
          <Switch
            label="Primary"
            description="Mirror response to caller"
            checked={form.primary}
            onChange={e => setField('primary', e.target.checked)}
          />
        </Group>

        <Divider label="Custom Headers" labelPosition="left" />

        {headerRows.map((row, idx) => (
          <Group key={idx} align="flex-end" gap="xs">
            <TextInput
              placeholder="Header-Name"
              value={row.key}
              onChange={e => updateHeader(idx, 'key', e.target.value)}
              style={{ flex: 1 }}
              size="sm"
            />
            <TextInput
              placeholder="value"
              value={row.value}
              onChange={e => updateHeader(idx, 'value', e.target.value)}
              style={{ flex: 2 }}
              size="sm"
            />
            <ActionIcon color="red" variant="subtle" onClick={() => removeHeader(idx)}>
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        ))}

        <Button
          variant="light"
          size="xs"
          leftSection={<IconPlus size={14} />}
          onClick={addHeader}
          w="fit-content"
        >
          Add Header
        </Button>

        <Divider label="Retry" labelPosition="left" />

        <Switch
          label="Enable Retry"
          checked={form.retry.enabled}
          onChange={e => setRetry('enabled', e.target.checked)}
        />

        {form.retry.enabled && (
          <Paper withBorder p="sm" radius="sm">
            <Stack gap="sm">
              <Group grow>
                <NumberInput
                  label="Max Attempts"
                  value={form.retry.max_attempts}
                  onChange={v => setRetry('max_attempts', Number(v))}
                  min={1}
                  max={100}
                  size="sm"
                />
                <TextInput
                  label="Interval"
                  placeholder="5s"
                  value={form.retry.interval}
                  onChange={e => setRetry('interval', e.target.value)}
                  size="sm"
                  description="e.g. 5s, 1m"
                />
              </Group>

              <Box>
                <Text size="xs" fw={500} mb={4}>Backoff Strategy</Text>
                <SegmentedControl
                  size="xs"
                  value={form.retry.backoff}
                  onChange={v => setRetry('backoff', v as 'fixed' | 'exponential')}
                  data={[
                    { value: 'fixed',       label: 'Fixed' },
                    { value: 'exponential', label: 'Exponential' },
                  ]}
                />
              </Box>

              <TagsInput
                label="Disable on Status Codes"
                placeholder="e.g. 400, 401, 403"
                value={(form.retry.disable_on_status ?? []).map(String)}
                onChange={v => setRetry('disable_on_status', v.map(Number).filter(n => !isNaN(n)))}
                size="sm"
                description="Press Enter after each code"
              />

              <TagsInput
                label="Disable if Body Contains"
                placeholder="e.g. not_found, invalid"
                value={form.retry.disable_on_body_contains ?? []}
                onChange={v => setRetry('disable_on_body_contains', v)}
                size="sm"
                description="Press Enter after each string"
              />
            </Stack>
          </Paper>
        )}

        <Divider />

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!form.id || !form.url}
          >
            Save Target
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
