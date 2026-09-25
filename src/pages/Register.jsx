import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { AuthShell } from '@/components/auth/AuthShell'

export default function Register() {
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setMessage(null)
    // Checked before signUp: a typo here would lock the lifter out of a brand-new account.
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setSubmitting(true)
    try {
      const { session } = await signUp(email, password)
      if (session) {
        navigate('/', { replace: true })
      } else {
        // Supabase project has email confirmation on — no session until the link is clicked.
        setMessage('Check your email to confirm your account, then log in.')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      title="Start training"
      subtitle="Two minutes to set up, then describe your first lift."
      submitLabel="Create account"
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
        {
          name: 'password',
          label: 'Password',
          type: 'password',
          placeholder: '••••••••',
          value: password,
          onChange: (e) => setPassword(e.target.value),
          autoComplete: 'new-password',
        },
        {
          name: 'confirm',
          label: 'Confirm password',
          type: 'password',
          placeholder: '••••••••',
          value: confirm,
          onChange: (e) => setConfirm(e.target.value),
          autoComplete: 'new-password',
        },
      ]}
      links={[{ pre: 'Already have an account? ', text: 'Log in', to: '/login' }]}
    />
  )
}
