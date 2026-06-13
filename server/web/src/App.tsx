import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { Center, Loader } from '@mantine/core'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/Login'
import { SourcesPage } from './pages/Sources'
import { TargetsPage } from './pages/Targets'
import { LogsPage } from './pages/Logs'
import { getMe } from './api/client'

function Protected({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const [checking, setChecking] = useState(true)
  const [authed, setAuthed] = useState(false)

  useEffect(() => {
    getMe()
      .then(() => setAuthed(true))
      .catch(() => navigate('/login', { replace: true }))
      .finally(() => setChecking(false))
  }, [navigate])

  if (checking) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    )
  }

  if (!authed) return null

  return <Layout>{children}</Layout>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Navigate to="/sources" replace />} />
      <Route path="/sources" element={<Protected><SourcesPage /></Protected>} />
      <Route path="/targets" element={<Protected><TargetsPage /></Protected>} />
      <Route path="/logs" element={<Protected><LogsPage /></Protected>} />
      <Route path="*" element={<Navigate to="/sources" replace />} />
    </Routes>
  )
}
