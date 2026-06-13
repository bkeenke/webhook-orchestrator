import { useState, useEffect, useCallback } from 'react'
import {
  Stack, Group, Button, Text, Title, Select, Table, Badge, Center,
  Loader, Alert, TextInput, Pagination, Box, ActionIcon, Tooltip,
  SegmentedControl,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import {
  IconRefresh, IconTrash, IconSearch, IconAlertCircle, IconList,
} from '@tabler/icons-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import { modals } from '@mantine/modals'
import type { LogSummary } from '../types'
import { getLogs, clearLogs, getLogFilters } from '../api/client'
import { LogDetailModal } from '../components/LogDetailModal'

const PER_PAGE_OPTIONS = [
  { value: '25',  label: '25' },
  { value: '50',  label: '50' },
  { value: '100', label: '100' },
]

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

function formatRelative(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(ts).toLocaleString()
}

const methodColor: Record<string, string> = {
  GET: 'blue', POST: 'green', PUT: 'orange', PATCH: 'teal',
  DELETE: 'red', HEAD: 'gray', OPTIONS: 'violet',
}

export function LogsPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [debouncedSearch] = useDebouncedValue(search, 350)
  const [sourceFilter, setSourceFilter] = useState<string | null>(null)
  const [targetFilter, setTargetFilter] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null)

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1) }, [debouncedSearch, sourceFilter, targetFilter, perPage])

  const { data: filters } = useQuery({
    queryKey: ['log-filters'],
    queryFn: getLogFilters,
  })

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['logs', debouncedSearch, sourceFilter, targetFilter, page, perPage],
    queryFn: () => getLogs({
      limit: perPage,
      offset: (page - 1) * perPage,
      q: debouncedSearch || undefined,
      source: sourceFilter || undefined,
      target: targetFilter || undefined,
    }),
  })

  const clearMutation = useMutation({
    mutationFn: clearLogs,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logs'] })
      notifications.show({ message: 'All logs cleared', color: 'orange' })
      setPage(1)
    },
    onError: (err: Error) => {
      notifications.show({ title: 'Error', message: err.message, color: 'red' })
    },
  })

  function confirmClear() {
    modals.openConfirmModal({
      title: 'Clear All Logs',
      children: <Text size="sm">This will permanently delete all log entries. This cannot be undone.</Text>,
      labels: { confirm: 'Clear All', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => clearMutation.mutate(),
    })
  }

  const total = data?.total ?? 0
  const items = data?.items ?? []
  const totalPages = Math.ceil(total / perPage)
  const startIdx = (page - 1) * perPage + 1
  const endIdx = Math.min(page * perPage, total)

  const sourceOptions = [
    { value: '', label: 'All sources' },
    ...(filters?.sources ?? []).map(s => ({ value: s, label: s })),
  ]

  const targetOptions = [
    { value: '', label: 'All targets' },
    ...(filters?.targets ?? []).map(t => ({ value: t, label: t })),
  ]

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={3}>Logs</Title>
        <Group gap="xs">
          <ActionIcon
            variant="light"
            size="lg"
            onClick={() => refetch()}
            loading={isLoading}
            title="Refresh"
          >
            <IconRefresh size={16} />
          </ActionIcon>
          <Button
            variant="light"
            color="red"
            size="sm"
            leftSection={<IconTrash size={16} />}
            onClick={confirmClear}
            loading={clearMutation.isPending}
          >
            Clear
          </Button>
        </Group>
      </Group>

      {/* Filters */}
      <Group gap="sm" wrap="wrap">
        <TextInput
          placeholder="Search body (space = AND)..."
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={e => setSearch(e.target.value)}
          w={280}
          size="sm"
        />
        <Select
          placeholder="All sources"
          data={sourceOptions}
          value={sourceFilter ?? ''}
          onChange={v => setSourceFilter(v || null)}
          size="sm"
          w={180}
          clearable
          comboboxProps={{ withinPortal: true }}
        />
        <Select
          placeholder="All targets"
          data={targetOptions}
          value={targetFilter ?? ''}
          onChange={v => setTargetFilter(v || null)}
          size="sm"
          w={180}
          clearable
          comboboxProps={{ withinPortal: true }}
        />
      </Group>

      {error && (
        <Alert icon={<IconAlertCircle size={16} />} color="red">
          {(error as Error).message}
        </Alert>
      )}

      {isLoading ? (
        <Center h="40vh">
          <Loader />
        </Center>
      ) : items.length === 0 ? (
        <Center h="40vh">
          <Stack align="center" gap="xs">
            <IconList size={48} stroke={1} color="var(--mantine-color-dimmed)" />
            <Text c="dimmed" size="lg">No logs found</Text>
            <Text c="dimmed" size="sm">
              {debouncedSearch || sourceFilter || targetFilter
                ? 'Try adjusting your filters'
                : 'Logs will appear when webhooks are received'}
            </Text>
          </Stack>
        </Center>
      ) : (
        <>
          <Box style={{ overflowX: 'auto' }}>
            <Table striped highlightOnHover withTableBorder withColumnBorders fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Time</Table.Th>
                  <Table.Th>Source / Path</Table.Th>
                  <Table.Th>Method</Table.Th>
                  <Table.Th>IP</Table.Th>
                  <Table.Th>Targets</Table.Th>
                  <Table.Th>Size</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((log: LogSummary) => (
                  <Table.Tr
                    key={log.id}
                    onClick={() => setSelectedLogId(log.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>
                      <Tooltip label={new Date(log.timestamp).toLocaleString()} withinPortal>
                        <Text size="xs">{formatRelative(log.timestamp)}</Text>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td>
                      <Stack gap={2}>
                        <Text size="xs" fw={600}>{log.source_name}</Text>
                        <Text size="xs" c="dimmed" style={{ fontFamily: 'monospace' }}>{log.path}</Text>
                      </Stack>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={methodColor[log.method] ?? 'gray'} size="sm" variant="filled">
                        {log.method}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" style={{ fontFamily: 'monospace' }}>{log.client_ip}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="wrap">
                        {log.targets.map(t => (
                          <Badge key={t} size="xs" variant="light" color="blue">{t}</Badge>
                        ))}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{formatBytes(log.body_size)}</Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Box>

          {/* Pagination */}
          <Group justify="space-between" align="center">
            <Text size="sm" c="dimmed">
              {total > 0 ? `Showing ${startIdx}–${endIdx} of ${total}` : 'No results'}
            </Text>
            <Group gap="sm" align="center">
              <Text size="sm" c="dimmed">Per page:</Text>
              <SegmentedControl
                size="xs"
                value={String(perPage)}
                onChange={v => setPerPage(Number(v))}
                data={PER_PAGE_OPTIONS}
              />
              {totalPages > 1 && (
                <Pagination
                  value={page}
                  onChange={setPage}
                  total={totalPages}
                  size="sm"
                />
              )}
            </Group>
          </Group>
        </>
      )}

      <LogDetailModal
        logId={selectedLogId}
        onClose={() => setSelectedLogId(null)}
      />
    </Stack>
  )
}
