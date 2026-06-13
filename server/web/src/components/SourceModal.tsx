import { useEffect, useState } from 'react'
import {
  Modal, Stack, TextInput, Switch, Button, Group, Text, Paper,
  SegmentedControl, Select, MultiSelect, ActionIcon, Divider, Badge,
  Box, Alert, ScrollArea,
} from '@mantine/core'
import { IconPlus, IconTrash, IconInfoCircle } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import type { Source, Rule, Condition } from '../types'
import { saveSource, getTargets } from '../api/client'

const OPS = [
  { value: 'eq',           label: 'equals' },
  { value: 'ne',           label: 'not equals' },
  { value: 'contains',     label: 'contains' },
  { value: 'not_contains', label: 'not contains' },
  { value: 'starts_with',  label: 'starts with' },
  { value: 'ends_with',    label: 'ends with' },
  { value: 'exists',       label: 'exists' },
  { value: 'not_exists',   label: 'not exists' },
  { value: 'in',           label: 'in' },
  { value: 'not_in',       label: 'not in' },
  { value: 'regex',        label: 'regex' },
  { value: 'gt',           label: '>' },
  { value: 'gte',          label: '>=' },
  { value: 'lt',           label: '<' },
  { value: 'lte',          label: '<=' },
]

const NO_VALUE_OPS = new Set(['exists', 'not_exists'])

function newCondition(): Condition {
  return { field: '', op: 'eq', value: '' }
}

function newRule(): Rule {
  return {
    id: crypto.randomUUID(),
    name: '',
    logic: 'AND',
    conditions: [],
    targets: [],
  }
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

function emptySource(): Source {
  return {
    id: '',
    name: '',
    path: '/',
    methods: [],
    sync_response: false,
    rules: [],
  }
}

interface Props {
  opened: boolean
  source: Source | null
  onClose: () => void
}

export function SourceModal({ opened, source, onClose }: Props) {
  const qc = useQueryClient()
  const [form, setForm] = useState<Source>(emptySource())

  const { data: targets = [] } = useQuery({
    queryKey: ['targets'],
    queryFn: getTargets,
    enabled: opened,
  })

  const targetOptions = targets.map(t => ({
    value: t.id,
    label: `${t.id} (${t.url})`,
  }))

  useEffect(() => {
    if (opened) {
      setForm(source ? JSON.parse(JSON.stringify(source)) : emptySource())
    }
  }, [opened, source])

  const mutation = useMutation({
    mutationFn: () => saveSource(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sources'] })
      notifications.show({ message: `Source "${form.name}" saved`, color: 'green' })
      onClose()
    },
    onError: (err: Error) => {
      notifications.show({ title: 'Error', message: err.message, color: 'red' })
    },
  })

  function updateField<K extends keyof Source>(k: K, v: Source[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function addRule() {
    setForm(f => ({ ...f, rules: [...f.rules, newRule()] }))
  }

  function removeRule(idx: number) {
    setForm(f => ({ ...f, rules: f.rules.filter((_, i) => i !== idx) }))
  }

  function updateRule(idx: number, patch: Partial<Rule>) {
    setForm(f => ({
      ...f,
      rules: f.rules.map((r, i) => i === idx ? { ...r, ...patch } : r),
    }))
  }

  function addCondition(ruleIdx: number) {
    updateRule(ruleIdx, {
      conditions: [...form.rules[ruleIdx].conditions, newCondition()],
    })
  }

  function removeCondition(ruleIdx: number, condIdx: number) {
    updateRule(ruleIdx, {
      conditions: form.rules[ruleIdx].conditions.filter((_, i) => i !== condIdx),
    })
  }

  function updateCondition(ruleIdx: number, condIdx: number, patch: Partial<Condition>) {
    const conditions = form.rules[ruleIdx].conditions.map((c, i) =>
      i === condIdx ? { ...c, ...patch } : c
    )
    updateRule(ruleIdx, { conditions })
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={source ? `Edit Source: ${source.name}` : 'Add Source'}
      size="xl"
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <Stack gap="md">
        <TextInput
          label="Name"
          placeholder="my-webhook"
          value={form.name}
          onChange={e => updateField('name', e.target.value)}
          required
        />
        <TextInput
          label="Path"
          placeholder="/webhooks/my-hook"
          value={form.path}
          onChange={e => updateField('path', e.target.value)}
          required
          description="Incoming webhook path, e.g. /webhooks/stripe"
        />
        <MultiSelect
          label="Allowed HTTP Methods"
          description="Leave empty to allow all methods"
          data={HTTP_METHODS}
          value={form.methods ?? []}
          onChange={v => updateField('methods', v)}
          placeholder="All methods"
          clearable
        />
        <Switch
          label="Sync Response"
          description="Wait for target response and forward it back to the caller"
          checked={form.sync_response}
          onChange={e => updateField('sync_response', e.target.checked)}
        />

        <Divider label="Rules" labelPosition="left" />

        {form.rules.length === 0 && (
          <Alert icon={<IconInfoCircle size={16} />} color="blue" variant="light">
            No rules defined. Add rules to route incoming requests to targets.
          </Alert>
        )}

        {form.rules.map((rule, rIdx) => (
          <Paper key={rule.id} withBorder p="sm" radius="sm">
            <Stack gap="sm">
              <Group justify="space-between" align="flex-start">
                <Text fw={600} size="sm">Rule {rIdx + 1}</Text>
                <ActionIcon color="red" variant="subtle" onClick={() => removeRule(rIdx)}>
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>

              <TextInput
                label="Rule Name"
                placeholder="route-to-payment"
                value={rule.name}
                onChange={e => updateRule(rIdx, { name: e.target.value })}
                size="sm"
              />

              <Box>
                <Text size="xs" fw={500} mb={4}>Condition Logic</Text>
                <SegmentedControl
                  size="xs"
                  value={rule.logic}
                  onChange={v => updateRule(rIdx, { logic: v as 'AND' | 'OR' })}
                  data={[
                    { value: 'AND', label: 'AND (all must match)' },
                    { value: 'OR',  label: 'OR (any must match)' },
                  ]}
                />
              </Box>

              <Box>
                <Group justify="space-between" mb={4}>
                  <Text size="xs" fw={500}>Conditions</Text>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    leftSection={<IconPlus size={12} />}
                    onClick={() => addCondition(rIdx)}
                  >
                    Add Condition
                  </Button>
                </Group>

                {rule.conditions.length === 0 && (
                  <Badge color="orange" size="sm" variant="light">
                    No conditions — matches ALL requests
                  </Badge>
                )}

                {rule.conditions.map((cond, cIdx) => (
                  <Paper key={cIdx} withBorder p="xs" radius="sm" mb="xs" bg="var(--mantine-color-default-hover)">
                    <Group align="flex-end" gap="xs">
                      <TextInput
                        label="Field path"
                        placeholder="body.event"
                        value={cond.field}
                        onChange={e => updateCondition(rIdx, cIdx, { field: e.target.value })}
                        size="xs"
                        style={{ flex: 1 }}
                      />
                      <Select
                        label="Operator"
                        data={OPS}
                        value={cond.op}
                        onChange={v => updateCondition(rIdx, cIdx, { op: v ?? 'eq' })}
                        size="xs"
                        w={130}
                        allowDeselect={false}
                        comboboxProps={{ withinPortal: true }}
                      />
                      {!NO_VALUE_OPS.has(cond.op) && (
                        <TextInput
                          label="Value"
                          placeholder="payment.created"
                          value={cond.value}
                          onChange={e => updateCondition(rIdx, cIdx, { value: e.target.value })}
                          size="xs"
                          style={{ flex: 1 }}
                        />
                      )}
                      <ActionIcon
                        color="red"
                        variant="subtle"
                        onClick={() => removeCondition(rIdx, cIdx)}
                        style={{ marginBottom: 1 }}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Group>
                  </Paper>
                ))}
              </Box>

              <MultiSelect
                label="Route to Targets"
                placeholder="Select targets..."
                data={targetOptions}
                value={rule.targets}
                onChange={v => updateRule(rIdx, { targets: v })}
                size="sm"
                comboboxProps={{ withinPortal: true }}
              />
            </Stack>
          </Paper>
        ))}

        <Button
          variant="light"
          leftSection={<IconPlus size={16} />}
          onClick={addRule}
          fullWidth
        >
          Add Rule
        </Button>

        <Divider />

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!form.name || !form.path}
          >
            Save Source
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
