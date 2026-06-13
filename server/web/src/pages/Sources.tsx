import { useState } from 'react'
import {
  Stack, Group, Button, Text, Card, Badge, ActionIcon, SimpleGrid,
  Title, Center, Loader, Alert,
} from '@mantine/core'
import { IconPlus, IconEdit, IconTrash, IconWebhook, IconAlertCircle } from '@tabler/icons-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import { modals } from '@mantine/modals'
import type { Source } from '../types'
import { getSources, deleteSource } from '../api/client'
import { SourceModal } from '../components/SourceModal'

export function SourcesPage() {
  const qc = useQueryClient()
  const [editSource, setEditSource] = useState<Source | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  const { data: sources = [], isLoading, error } = useQuery({
    queryKey: ['sources'],
    queryFn: getSources,
  })

  const deleteMutation = useMutation({
    mutationFn: deleteSource,
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['sources'] })
      notifications.show({ message: 'Source deleted', color: 'orange' })
    },
    onError: (err: Error) => {
      notifications.show({ title: 'Error', message: err.message, color: 'red' })
    },
  })

  function openAdd() {
    setEditSource(null)
    setModalOpen(true)
  }

  function openEdit(s: Source) {
    setEditSource(s)
    setModalOpen(true)
  }

  function confirmDelete(s: Source) {
    modals.openConfirmModal({
      title: 'Delete Source',
      children: <Text size="sm">Are you sure you want to delete source <strong>{s.name}</strong>? This cannot be undone.</Text>,
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(s.id),
    })
  }

  if (isLoading) {
    return (
      <Center h="50vh">
        <Loader />
      </Center>
    )
  }

  if (error) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} color="red" title="Failed to load sources">
        {(error as Error).message}
      </Alert>
    )
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={3}>Sources</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={openAdd}>
          Add Source
        </Button>
      </Group>

      {sources.length === 0 ? (
        <Center h="40vh">
          <Stack align="center" gap="xs">
            <IconWebhook size={48} stroke={1} color="var(--mantine-color-dimmed)" />
            <Text c="dimmed" size="lg">No sources yet</Text>
            <Text c="dimmed" size="sm">Create a source to start receiving webhooks</Text>
            <Button mt="xs" leftSection={<IconPlus size={16} />} onClick={openAdd}>
              Add your first source
            </Button>
          </Stack>
        </Center>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {sources.map(source => (
            <Card key={source.id} withBorder shadow="sm" radius="md" padding="md">
              <Stack gap="xs">
                <Group justify="space-between" align="flex-start">
                  <Text fw={600} size="md" style={{ flex: 1 }}>
                    {source.name}
                  </Text>
                  <Group gap={4}>
                    <ActionIcon variant="subtle" onClick={() => openEdit(source)}>
                      <IconEdit size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      onClick={() => confirmDelete(source)}
                      loading={deleteMutation.isPending && deleteMutation.variables === source.id}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                </Group>

                <Group gap="xs" wrap="wrap">
                  <Badge variant="light" color="blue" size="sm">
                    {source.path}
                  </Badge>
                  {source.sync_response && (
                    <Badge variant="light" color="teal" size="sm">
                      sync
                    </Badge>
                  )}
                  <Badge variant="light" color="gray" size="sm">
                    {source.rules.length} rule{source.rules.length !== 1 ? 's' : ''}
                  </Badge>
                </Group>

                {source.rules.length > 0 && (
                  <Stack gap={4}>
                    {source.rules.map(rule => (
                      <Group key={rule.id} gap={4} wrap="wrap">
                        <Text size="xs" c="dimmed" fw={500}>{rule.name || '(unnamed rule)'}:</Text>
                        {rule.conditions.length === 0 ? (
                          <Badge size="xs" color="orange" variant="dot">matches all</Badge>
                        ) : (
                          <Badge size="xs" color="gray" variant="outline">
                            {rule.conditions.length} condition{rule.conditions.length !== 1 ? 's' : ''}
                          </Badge>
                        )}
                        {rule.targets.length > 0 && (
                          <Text size="xs" c="dimmed">→ {rule.targets.join(', ')}</Text>
                        )}
                      </Group>
                    ))}
                  </Stack>
                )}
              </Stack>
            </Card>
          ))}
        </SimpleGrid>
      )}

      <SourceModal
        opened={modalOpen}
        source={editSource}
        onClose={() => setModalOpen(false)}
      />
    </Stack>
  )
}
