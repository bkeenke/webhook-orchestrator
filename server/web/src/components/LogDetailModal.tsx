import {
  Drawer, Stack, Group, Text, Badge, Table, ScrollArea, Loader,
  Center, Divider, Box, Paper, Alert,
} from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { getLog } from '../api/client'
import { IconAlertCircle } from '@tabler/icons-react'

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

function tryFormatJSON(s: string): { formatted: string; isJson: boolean } {
  if (!s) return { formatted: '', isJson: false }
  try {
    const parsed = JSON.parse(s)
    return { formatted: JSON.stringify(parsed, null, 2), isJson: true }
  } catch {
    return { formatted: s, isJson: false }
  }
}

function statusColor(status: number): string {
  if (status < 300) return 'green'
  if (status < 500) return 'yellow'
  return 'red'
}

function BodyBlock({ body }: { body: string }) {
  if (!body) return <Text size="xs" c="dimmed">(empty)</Text>
  const { formatted } = tryFormatJSON(body)
  return (
    <Box
      component="pre"
      style={{
        margin: 0,
        padding: '8px',
        borderRadius: '4px',
        backgroundColor: 'var(--mantine-color-dark-light)',
        fontSize: '12px',
        overflow: 'auto',
        maxHeight: 300,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        fontFamily: 'var(--mantine-font-family-monospace)',
      }}
    >
      {formatted}
    </Box>
  )
}

interface Props {
  logId: string | null
  onClose: () => void
}

export function LogDetailModal({ logId, onClose }: Props) {
  const { data: log, isLoading, error } = useQuery({
    queryKey: ['log', logId],
    queryFn: () => getLog(logId!),
    enabled: !!logId,
  })

  const methodColor: Record<string, string> = {
    GET: 'blue', POST: 'green', PUT: 'orange', PATCH: 'teal',
    DELETE: 'red', HEAD: 'gray', OPTIONS: 'violet',
  }

  return (
    <Drawer
      opened={!!logId}
      onClose={onClose}
      title="Request Detail"
      position="right"
      size="xl"
      scrollAreaComponent={ScrollArea.Autosize}
    >
      {isLoading && (
        <Center h="50vh">
          <Loader />
        </Center>
      )}

      {error && (
        <Alert icon={<IconAlertCircle size={16} />} color="red">
          {(error as Error).message}
        </Alert>
      )}

      {log && (
        <Stack gap="md">
          {/* Header */}
          <Group gap="xs" align="center">
            <Badge color={methodColor[log.method] ?? 'gray'} size="lg" variant="filled">
              {log.method}
            </Badge>
            <Text fw={600} style={{ wordBreak: 'break-all', flex: 1 }}>{log.path}</Text>
          </Group>

          <Text size="sm" c="dimmed">
            {new Date(log.timestamp).toLocaleString()}
          </Text>

          {/* Meta */}
          <Group gap="xs" wrap="wrap">
            <Badge variant="light" color="gray" size="sm">IP: {log.client_ip}</Badge>
            <Badge variant="light" color="gray" size="sm">Size: {formatBytes(log.body_size)}</Badge>
            {(log.targets ?? []).map(t => (
              <Badge key={t} variant="light" color="blue" size="sm">{t}</Badge>
            ))}
          </Group>

          <Divider label="Request Headers" labelPosition="left" />

          {Object.keys(log.headers).length > 0 ? (
            <Table striped withTableBorder withColumnBorders fz="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={200}>Header</Table.Th>
                  <Table.Th>Value</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {Object.entries(log.headers ?? {}).map(([k, v]) => (
                  <Table.Tr key={k}>
                    <Table.Td fw={500}>{k}</Table.Td>
                    <Table.Td style={{ wordBreak: 'break-all' }}>{v}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ) : (
            <Text size="xs" c="dimmed">(no headers)</Text>
          )}

          <Divider label="Request Body" labelPosition="left" />
          <BodyBlock body={log.body} />

          <Divider label="Target Responses" labelPosition="left" />

          {Object.keys(log.target_responses ?? {}).length === 0 ? (
            <Text size="xs" c="dimmed">No target responses recorded</Text>
          ) : (
            Object.entries(log.target_responses ?? {}).map(([targetId, resp]) => (
              <Paper key={targetId} withBorder p="sm" radius="sm">
                <Stack gap="xs">
                  <Group gap="xs">
                    <Text fw={600} size="sm">{targetId}</Text>
                    <Badge color={statusColor(resp.status)} size="sm" variant="filled">
                      {resp.status}
                    </Badge>
                    {resp.error && (
                      <Badge color="red" size="sm" variant="light">error</Badge>
                    )}
                  </Group>
                  {resp.error && (
                    <Text size="xs" c="red">{resp.error}</Text>
                  )}
                  <BodyBlock body={resp.body} />
                </Stack>
              </Paper>
            ))
          )}
        </Stack>
      )}
    </Drawer>
  )
}
