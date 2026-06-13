import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Center, Paper, Stack, TextInput, PasswordInput, Button, Title, Text, ThemeIcon,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMutation } from '@tanstack/react-query'
import { login } from '../api/client'
import { IconWebhook } from '@tabler/icons-react'

export function LoginPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const mutation = useMutation({
    mutationFn: () => login(username, password),
    onSuccess: () => {
      navigate('/', { replace: true })
    },
    onError: (err: Error) => {
      notifications.show({ title: 'Login failed', message: err.message, color: 'red' })
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    mutation.mutate()
  }

  return (
    <Center h="100vh" bg="var(--mantine-color-gray-light)">
      <Paper withBorder shadow="md" p={36} radius="md" w={380}>
        <Stack gap="md">
          <Stack gap={4} align="center">
            <ThemeIcon size={48} radius="md" color="blue" variant="light">
              <IconWebhook size={28} stroke={1.5} />
            </ThemeIcon>
            <Title order={2} ta="center">Webhook Orchestrator</Title>
            <Text ta="center" c="dimmed" size="sm">Sign in to manage your webhooks</Text>
          </Stack>
          <form onSubmit={handleSubmit}>
            <Stack gap="sm">
              <TextInput
                label="Username"
                placeholder="admin"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
                autoFocus
              />
              <PasswordInput
                label="Password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
              <Button type="submit" fullWidth mt="xs" loading={mutation.isPending}>
                Sign in
              </Button>
            </Stack>
          </form>
        </Stack>
      </Paper>
    </Center>
  )
}
