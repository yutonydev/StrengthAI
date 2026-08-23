import { useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { AuthShell } from '@/components/auth/AuthShell'

export default function ForgotPassword() {
  const { requestPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    // Cleared alongside the error, matching Register. Without this a second send left the
    // previous "Reset link sent" notice on screen throughout, so a failed resend looked
    // like it had succeeded.
    setMessage(null)
    setSubmitting(true)
    try {
      await requestPasswordReset(email)
      setMessage('Reset link sent. Check your inbox — the link expires in 30 minutes.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      title="Reset password"
      subtitle="We will send a link to your email."
      submitLabel="Send reset link"
      submitting={submitting}
      error={error}
      message={message}
      onSubmit={handleSubmit}
      fields={[
        {
          name: 'email',
          label: 'Email',
          type: 'email',
          placeholder: 'you@example.com',
          value: email,
          onChange: (e) => setEmail(e.target.value),
          autoComplete: 'email',
        },
      ]}
      links={[{ pre: '', text: 'Back to log in', to: '/login' }]}
    />
  )
}
